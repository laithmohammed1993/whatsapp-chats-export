const { Client , ClientInfo, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode')
const database = require('../middleware/database.js')
const path = require('path');
const fs = require('fs');
const { getDatetimeString } = require('../middleware/fun.js');

var GlobalClient = null;
function removeClientSession(params={ 'clientId':Number() },callback=()=>{}) {
  // let sessionPath = path.join(process.cwd(),`.wwebjs_auth/session-${params.clientId}`)
  // fs.rm(sessionPath, { recursive: true, force: true }, (error) => {
  //   if( !error ){
  //     callback({ 'status':200 })
  //   } else {
  //     callback({ 'status':403,error })
  //   }
  // })
}

function globalListeners(params={ 'clientId':Number() }) {
  // Catch and log any other errors
  GlobalClient.on('error', (error) => {
    console.error('An error occurred:', error.message);
    if (error.message.includes('Execution context was destroyed')) {
      console.log('Handling protocol error due to execution context being destroyed');
      // You might want to reload the page, reinitialize the client, or take other actions
      // GlobalClient.destroy();
      // GlobalClient = null;
    }
  });
  //
  GlobalClient.on('disconnected', (reason) => {
    removeClientSession(params)
    console.log('Client was logged out:', reason);
    // GlobalClient = null
  });
  GlobalClient.on('auth_failure', (message) => {
    console.error('Authentication failed:', message);
    // Clear saved sessions and restart client
    // GlobalClient.destroy();
  });
}
//
function createNewClient(params={ 'clientId':Number() },callback=()=>{}) {
  let qrCollected = false;
  try{
    GlobalClient = null;
    let client = new Client({
      authStrategy: new LocalAuth({ 'clientId':String(params.clientId) }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      }
    });
    client.once('ready',async ()=>{
      console.log('ready',qrCollected,GlobalClient===null)
      if( GlobalClient === null ){
        GlobalClient = client;
        globalListeners({ 'clientId':params.clientId })
        let [ error1 , clients ] = await database.queryAsync({ sql:database.format('SELECT * FROM clients WHERE id = ?',[params.clientId]) })
        if( !error1 ){
          let { 'wid':{ '_serialized':clientUniqeId } } = client.info;
          if( clients.length === 0 ){
            database.query({ sql:database.format(`INSERT INTO clients (lastActiveDateTime,clientUniqeId,createdDateTime) VALUES (?,?,?)`,[Date.now(),clientUniqeId,Date.now()]) })
          } else {
            let [ error2 ] = await database.queryAsync({ sql:database.format(`UPDATE clients SET lastActiveDateTime = ? , clientUniqeId = ? WHERE id = ?`,[Date.now(),clientUniqeId,params.clientId]) })
            if( !error2 ){
              if( qrCollected === false ){
                qrCollected = true
                callback({ 'status':200 })
              }
            }
          }
        } else {
          console.log(error1)
        }
      }
    })
    client.on('qr', (qr) => {
      console.log('qr',qrCollected)
      if( qrCollected === false ){
        // console.log('QR RECEIVED', qr);
        qrCollected = true
        qrcode.toString(qr, { small: true }, (error, qrString) => {
          if (error) {
            callback({ 'status':403,error})
          } else {
            callback({ 'status':200,'data':{qrString} })
          }
        });
      }
    });
    client.initialize();
  } catch(error){
    console.log(error.message)
    callback({ 'status':403,error })
  }
}

async function saveCollectedMessagesAsync(params={}) {
  try {
    let { chatUniqeId , clientUniqeId , messages , currentDateTime , clientId } = params;
    //
    for( let message of messages ){
      let { timestamp , fromMe , body } = message;
      let senderUniqeId = message.author || message.from || null;
      await database.queryAsync({sql:database.format(
        `INSERT OR IGNORE INTO messageslogs (message,messageDateTime,clientUniqeId,senderUniqeId,chatUniqeId,fromClient) VALUES (?,?,?,?,?,?);`,
        [body,timestamp*1000,clientUniqeId,senderUniqeId,chatUniqeId._serialized,fromMe===true?1:2]
      )})
    }
    await database.queryAsync({ sql:database.format('UPDATE clients SET lastCollectedLogDateTime = ? WHERE id = ?',[currentDateTime,clientId]) })
    return { 'status':200 }
  } catch (error) {
    return { 'status':403,error }
  }
}

async function collectMessagesLogFromChat(params={ 'clientId':Number(), 'chatUniqeId':String() }) {
  try {
    let { clientId , chatUniqeId } = params;
    let [ error1 , clients ] = await database.queryAsync({ sql:database.format('SELECT * FROM clients WHERE id = ?;',[clientId]) })
    if( !error1 && clients.length === 1 ){
      let { clientUniqeId } = clients[0];
      //
      let [ error2 , messageslogs ] = await database.queryAsync({ sql:database.format('SELECT messageDateTime FROM messageslogs WHERE clientUniqeId = ? AND chatUniqeId = ? ORDER BY messageDateTime DESC LIMIT 1;',[clientUniqeId,chatUniqeId._serialized]) })
      // console.log(error2, messageslogs)
      let currentDateTime           = Date.now()
      let lastCollectedLogDateTime  = (messageslogs[0]||{}).messageDateTime || (currentDateTime-(1000*60*60*24*7))
      
      let chat = await GlobalClient.getChatById(chatUniqeId._serialized);
      if( chat ){
        let collectedMessages = [];
        let counter           = 0;
        do {
          let messages = await chat.fetchMessages({ limit: counter===0?1:100*counter });
          let rangeCollected = messages.some(message=>(message.timestamp*1000)>=lastCollectedLogDateTime);
          if( counter === 3 && messages.filter(message=>(message.timestamp*1000)>=lastCollectedLogDateTime).length === 0 ){
            rangeCollected = true
          }
          // console.log(counter,messages.map(m=>m.type),rangeCollected)
          if( rangeCollected === true || messages.length === 0 ){
            messages = messages.filter(message=>(message.timestamp*1000)>=lastCollectedLogDateTime);
            collectedMessages = messages;
            counter = null
          } else {
            counter++;
          }
        } while (counter !== null);
        //
        let saveLog = await saveCollectedMessagesAsync({ chatUniqeId , clientUniqeId , clientId , 'messages':collectedMessages , currentDateTime })
        if( saveLog.status !== 200 ){
          throw new Error(saveLog.error)
        }
        let [ error3 , newMessagesCount ] = await database.queryAsync({ sql:database.format('SELECT COUNT(id) as totalNewMessages FROM messageslogs WHERE clientUniqeId = ? AND chatUniqeId = ? AND isExported IS NULL;',[clientUniqeId,chatUniqeId._serialized]) })
        //
        return { 'status':200 , 'data':{ 'totalNewMessages':newMessagesCount[0].totalNewMessages } }
      } else {
        return { 'status':403,'error':{ 'message':`there is no any chat has this ID : ${chatUniqeId}` } }
      }
    } else {
      return { 'status':403,'error':{ 'message':`there is no any client has this ID : ${clientUniqeId}` } }
    }
  } catch (error) {
    console.log(error)
    return { 'status':403,error }
  }
  
}

async function getChatsAsync(params={ 'clientId':Number() }) {
  let { clientId } = params;
  if( GlobalClient !== null ){
    const chats = await GlobalClient.getChats();
    // let { 'wid':{ '_serialized':clientUniqeId } } = GlobalClient.info;
    console.log(`we have ${chats.length} chats`)
    console.log(chats[0])
    for( let index in chats ){
      let chat = chats[index]
      let chatUniqeId = chat.id;
      // if( index === '5' ){
        let log = await collectMessagesLogFromChat({ chatUniqeId , clientId ,  })
        if( log.status === 200 ){
          console.log(`${index} - ${chatUniqeId._serialized} : ${JSON.stringify(log)}`);
        } else {
          console.log(log);
          break;
        }
      // }
    }
  }
}

function getActiveClientState(params={},callback=()=>{}) {
  let data = {
    'activeClinetUniqeId' : null
  }
  if( GlobalClient !== null && typeof GlobalClient.info === 'object' ){
    let { 'wid':{ '_serialized':clientUniqeId } } = GlobalClient.info;
    //
    data.activeClinetUniqeId = clientUniqeId
  }
  callback({ 'status':200,data })
}
const getActiveClientStateAsync = (params={})=>new Promise((rs,rj)=>getActiveClientState(params,log=>rs(log)));

module.exports = {
  createNewClient,
  getActiveClientState,
  getActiveClientStateAsync,
  removeClientSession,
  getChatsAsync,
}
const { Client , ClientInfo, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode')
const database = require('../middleware/database.js')
const path = require('path');
const fs = require('fs');
const fun = require('../middleware/fun.js');

var GlobalClient = null;
let initialExportState = {
  status:null,
  total:null,
  collected:null,
  clientId:null,
  exportDateTime:null
} 
var sessionQrCode = null;
var exportState = JSON.parse(JSON.stringify(initialExportState))
//
function removeClientSession(params={ 'clientId':Number() },callback=()=>{}) {
  let sessionPath = path.join(process.cwd(),`.wwebjs_auth/session-${params.clientId}`)
  database.query({ sql:database.format(`UPDATE clients SET statusId = 2 WHERE id = ?`,[params.clientId]) },(error)=>{
    if( !error ){
      fs.rm(sessionPath, { recursive: true, force: true }, (error) => {
        if( !error ){
          callback({ 'status':200 })
        } else {
          callback({ 'status':403,error })
        }
      })
    }
  })
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
async function createNewClient(params={ 'clientId':Number(),'phoneNumber':String() },callback=()=>{}) {
  let { phoneNumber , clientId } = params;
  try{
    GlobalClient = null;
    //
    if( typeof phoneNumber === 'string'  ){
      let [ error , clients ] = await database.queryAsync({ sql:database.format(`SELECT id FROM clients WHERE clientUniqeId LIKE ?`,[`%${phoneNumber.trim().replaceAll(' ','')}@c.us`]) })
      if( !error && clients.length > 0 ){
        clientId = clients[0].id
      }
    }
    //
    if( Number.isInteger(clientId) ){
      sessionQrCode = null;
      //
      let client = new Client({
        authStrategy: new LocalAuth({ 'clientId':String(clientId) }),
        puppeteer: {
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
      });
      //
      client.once('ready',async ()=>{
        sessionQrCode = null
        console.log('ready',GlobalClient===null)
        if( GlobalClient === null ){
          exportState = JSON.parse(JSON.stringify(initialExportState))
          GlobalClient = client;
          globalListeners({ 'clientId':clientId })
          let [ error1 , clients ] = await database.queryAsync({ sql:database.format('SELECT * FROM clients WHERE id = ?',[clientId]) })
          if( !error1 ){
            let { 'wid':{ '_serialized':clientUniqeId } } = client.info;
            if( clients.length === 0 ){
              database.query({ sql:database.format(`INSERT INTO clients (lastActiveDateTime,clientUniqeId,createdDateTime) VALUES (?,?,?)`,[Date.now(),clientUniqeId,Date.now()]) })
            } else {
              let [ error2 ] = await database.queryAsync({ sql:database.format(`UPDATE clients SET lastActiveDateTime = ? , clientUniqeId = ? , statusId = 1 WHERE id = ?`,[Date.now(),clientUniqeId,clientId]) })
              if( !error2 ){
                console.log('Client active datatime updated')
              }
            }
          } else {
            console.log(error1)
          }
        }
      })
      client.on('qr', (qr) => {
        console.log(`QR code collected`)
        qrcode.toString(qr, { small: true }, (error, qrString) => {
          if ( !error ){
            sessionQrCode = qrString;
          }
        });
      });
      client.initialize();
      callback({ 'status':200})
    } else {
      callback({ 'status':403,'error':{ 'message':`invalid client` } })
    }
  } catch(error){
    console.log(error.message)
    callback({ 'status':403,error })
  }
}

async function saveCollectedMessagesAsync(params={}) {
  try {
    let { chatUniqeId , clientUniqeId , messages , currentDateTime , clientId , chatName } = params;
    //
    for( let message of messages ){
      let { timestamp , fromMe , body , type } = message;
      // console.log(message)
      let senderUniqeId = message.author || message.from || null;
      type = type==='chat'?null:type;
      await database.queryAsync({sql:database.format(
        `INSERT OR IGNORE INTO messageslogs 
        (clientUniqeId,fromClient,chatUniqeId,senderUniqeId,message,messageType,messageDateTime,exportedDateTime) 
        VALUES (?,?,?,?,?,?,?,?);`,
        [clientUniqeId,fromMe===true?1:2,chatUniqeId._serialized,senderUniqeId,body,type,timestamp*1000,currentDateTime]
      )})
    }
    await database.queryAsync({ sql:database.format('UPDATE clients SET lastCollectedLogDateTime = ? WHERE id = ?',[currentDateTime,clientId]) })
    return { 'status':200 }
  } catch (error) {
    return { 'status':403,error }
  }
}

async function clientLogoutAsync(params={},options={}) {
  if( GlobalClient !== null && typeof GlobalClient.logout === 'function'){
    // let log = await GlobalClient.destroy();
    GlobalClient = null
    return { 'status':200 }
  } else {
    return { 'status':403 }
  }
}

async function collectMessagesLogFromChat(params={ 'clientId':Number(), 'chatUniqeId':String() , 'chatName':String() }) {
  try {
    let { clientId , chatUniqeId , chatName , currentDateTime } = params;
    let [ error1 , clients ] = await database.queryAsync({ sql:database.format('SELECT * FROM clients WHERE id = ?;',[clientId]) })
    if( !error1 && clients.length === 1 ){
      let { clientUniqeId } = clients[0];
      //
      let [ error2 , messageslogs ] = await database.queryAsync({ sql:database.format('SELECT messageDateTime FROM messageslogs WHERE clientUniqeId = ? AND chatUniqeId = ? ORDER BY messageDateTime DESC LIMIT 1;',[clientUniqeId,chatUniqeId._serialized]) })
      // console.log(error2, messageslogs)
      let lastCollectedLogDateTime  = (messageslogs[0]||{}).messageDateTime || (currentDateTime-(1000*60*60*24*7))
      
      let chat = await GlobalClient.getChatById(chatUniqeId._serialized);
      if( chat ){
        await collectChatMembersAsync({ chat , clientUniqeId , currentDateTime })
        let collectedMessages = [];
        let counter           = 0;
        do {
          let messages = await chat.fetchMessages({ limit: counter===0?1:100*counter });
          if( counter === 0 ){ console.log(messages.length,fun.getDatetimeString(lastCollectedLogDateTime)) }
          if( counter === 0 && Array.isArray(messages) && (messages[0]||{}).timestamp*1000 > lastCollectedLogDateTime ){
            counter ++;
          } else {
            let rangeCollected = null
            let _uncollectedMessages = messages.filter(message=>(message.timestamp*1000)>=lastCollectedLogDateTime);
            if( counter === 10 || _uncollectedMessages.length === 0 || _uncollectedMessages.length !== messages.length ){
              rangeCollected = true
            }
            if( rangeCollected === true ){
              collectedMessages = _uncollectedMessages;
              counter = null
            } else {
              counter++;
            }
          }
          
        } while (counter !== null);
        //
        let saveLog = await saveCollectedMessagesAsync({ chatUniqeId , clientUniqeId , clientId , chatName , 'messages':collectedMessages , currentDateTime })
        if( saveLog.status !== 200 ){
          throw new Error(saveLog.error)
        }
        let [ error3 , newMessagesCount ] = await database.queryAsync({ sql:database.format('SELECT COUNT(id) as totalNewMessages FROM messageslogs WHERE clientUniqeId = ? AND chatUniqeId = ? AND exportedDateTime = ?;',[clientUniqeId,chatUniqeId._serialized,currentDateTime]) })
        //
        return { 'status':200 , 'data':{ 'totalNewMessages':((newMessagesCount||[])[0]||{}).totalNewMessages } }
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
    let currentDateTime           = Date.now()
    console.log(`we have ${chats.length} chats`)
    exportState.clientId = clientId;
    exportState.total = chats.length;
    exportState.exportDateTime = currentDateTime;
    exportState.status = 'ON_GOING';
    exportState.collected = 0
    // console.log(chats[0])
    for( let index in chats ){
      let chat = chats[index]
      let chatUniqeId = chat.id;
      let chatName = chat.name || ''
      // if( index === '5' ){
        let log = await collectMessagesLogFromChat({ chatUniqeId , clientId , chatName , currentDateTime })
        if( log.status === 200 ){
          exportState.collected = exportState.collected + 1
          // console.log(`${index} - ${chatUniqeId._serialized} : ${JSON.stringify(log)}`);
        } else {
          exportState.status = `ERROR : ${(log.error||{}).message}`
          console.log(log);
          break;
        }
      // }
      // break;
    }
    let data = undefined
    if( exportState.status === 'ON_GOING' ){
      exportState.status = 'COMPLATED'
      data = {};
      data.exportDateTime = currentDateTime;
    }
    //
    return { 'status':exportState.total === exportState.collected?200:403 , data }
  } else {
    return { 'status':403 }
  }
}

async function collectChatMembersAsync(params={}) {
  try {
    let { chatUniqeId , chat , clientUniqeId , currentDateTime } = params; // group:120363102906983543@g.us	chat:905524982486@c.us
    let collectedMembers = [];
    // Fetch the group chat
    if( !chat ){
      chat = await GlobalClient.getChatById(chatUniqeId);
    }
    // console.log(chat)
    // Get group members
    if( chat.isGroup ){
      let group = await GlobalClient.getContactById(chat.id._serialized);
      collectedMembers.push({ 'name':group.name,'pushname':group.pushname||null,'memberUniqeId':chat.id._serialized,type:2 })
      let groupMembers = chat.participants;
      // 
      for( let index in groupMembers ){
        let member = groupMembers[index];
        let contact = await GlobalClient.getContactById(member.id._serialized);
        collectedMembers.push({ 'name':contact.name,'pushname':contact.pushname,'memberUniqeId':member.id._serialized,type:1 })
      }
    } else {
      let contact = await GlobalClient.getContactById(chat.id._serialized);
      collectedMembers.push({ 'name':contact.name,'pushname':contact.pushname,'memberUniqeId':chat.id._serialized,type:1 })
    }
    // console.log(members)
    if( collectedMembers.length > 0 ){
      let [ error1 , members ] = await database.queryAsync({ 'sql':database.format(`SELECT * FROM members WHERE clientUniqeId = ?`,[clientUniqeId]) })
      if( !error1 ){
        let storedMembersLog = {};
        // clientUniqeId , memberUniqeId , name , pushname , type , createdDateTime
        for ( let i in members ){
          let storedMember = members[i];
          storedMembersLog[storedMember.memberUniqeId] = { 'name':storedMember.name,'pushname':storedMember.pushname||null,'type':storedMember.type };
        }
        //
        for( let o in collectedMembers ){
          let { memberUniqeId , name , type , pushname } = collectedMembers[o];
          if( storedMembersLog[memberUniqeId] ){
            // console.log(`${memberUniqeId}:${name} is updated`)
            await database.queryAsync({ sql:database.format(`
              UPDATE members SET name = ? , type = ? , pushname = ? , createdDateTime = ? 
              WHERE memberUniqeId = ? AND clientUniqeId = ?
            `,[name,type,pushname,currentDateTime,memberUniqeId,clientUniqeId]) })
          } else {
            // console.log(`${memberUniqeId}:${name} is inserted`)
            await database.queryAsync({ sql:database.format(`
              INSERT INTO members (name,type,pushname,createdDateTime,memberUniqeId,clientUniqeId)
              VALUES (?,?,?,?,?,?)
            `,[name,type,pushname,currentDateTime,memberUniqeId,clientUniqeId]) })
          }
        }
        // console.log(`totalCollected member for ${chat.id._serialized} is ${collectedMembers.length}`)
        //
        return { 'status':200 }
      } else {
        return { 'status':403,'error':error1 }
      }
    } else {
      return { 'status':200 }
    }
} catch (error) {
  return { 'status':403,error }
}
}

function getActiveClientState(params={},callback=()=>{}) {
  let data = {
    'activeClinetUniqeId' : null,
    'exportState':JSON.parse(JSON.stringify(initialExportState)),
    'qrCode':sessionQrCode,
  }
  if( GlobalClient !== null && typeof GlobalClient.info === 'object' ){
    let { 'wid':{ '_serialized':clientUniqeId } } = GlobalClient.info;
    //
    data.activeClinetUniqeId = clientUniqeId
    data.exportState = exportState
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
  clientLogoutAsync,
}
const express               = require('express');
const path                  = require('path');
const { createNewClient, getActiveClientState, getActiveClientStateAsync, removeClientSession, getChatsAsync }   = require('./assets/whatsapp-web');
const database              = require('./middleware/database');
const fun                   = require('./middleware/fun');
const app                   = express();
const port                  = 1991;

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));
// Middleware to parse JSON bodies
app.use(express.json());
// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));



app.get('/api/clients/create',(req,res)=>{
  let { clientId } = req.query
  clientId = parseInt(clientId);
  if( Number.isInteger(clientId) ){
    createNewClient({ clientId },(log)=>{
      res.json(log);
    })
  } else {
    database.query({ sql:'SELECT id as clientId FROM clients ORDER BY id DESC LIMIT 1' },(error,result)=>{
      if( !error ){
        createNewClient({ clientId:result.length+1 },log=>{
          res.json(log);
        })
      } else {
        res.json({ 'status':403,error });
      }
    })
  }
})
app.get('/api/clients/remove',(req,res)=>{
  let { clientId } = req.query
  clientId = parseInt(clientId);
  if( Number.isInteger(clientId) ){
    removeClientSession({ clientId },(log)=>{
      res.json(log);
    })
  } else {
    res.json({ 'status':403,'error':{ 'message':`client id is not valid` } });
  }
})
app.get('/api/client/messages-log',(req,res)=>{
  let { clientId } = req.query
  clientId = parseInt(clientId);
  if( Number.isInteger(clientId) ){
    getChatsAsync({ clientId })
    res.json({});
  } else {
    res.json({ 'status':403,'error':{ 'message':`client id is not valid` } });
  }
})
app.get('/api/clients/state',(req,res)=>{
  database.query({ sql:'SELECT * , id as clientId FROM clients;' },async(error,result)=>{
    if( !error ){
      let clients = result.map((row)=>{
        row.lastActiveDateTimeString = fun.getDatetimeString(row.lastActiveDateTime)
        row.createdDateTimeString = fun.getDatetimeString(row.createdDateTime)
        row.lastCollectedLogDateTimeString = Number.isInteger(row.lastCollectedLogDateTime)?fun.getDatetimeString(row.lastCollectedLogDateTime):'NULL'
        return row
      })
      let activeClientStateLog = await getActiveClientStateAsync({})
      let data = {
        'clients'           : clients,
        'activeClientState' : activeClientStateLog.data,
      }
      res.json({ 'status':200,data })
    } else {
      res.json({ 'status':403,error });
    }
  })
})

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});

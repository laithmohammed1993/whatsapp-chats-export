const express               = require('express');
const path                  = require('path');
const { createNewClient, getActiveClientState, getActiveClientStateAsync, removeClientSession, getChatsAsync, clientLogoutAsync }   = require('./assets/whatsapp-web');
const database              = require('./middleware/database');
const fun                   = require('./middleware/fun');
const { exportToExcelFileAsync } = require('./assets/export-to-excel-file');
const app                   = express();
const port                  = 1991;
const { exec }              = require('child_process');

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));
// Middleware to parse JSON bodies
app.use(express.json());
// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

app.get('/database/',(req,res)=>{
  let { 'databaseConnection':connection , 'query':{ query } } = req;
  if( typeof query === 'string' ){
    if( query.length > 0 && ['update ','insert ','drop ','delete '].every(s=>!query.includes(s)) ){
      database.query({ sql:query },(error,results)=>{
        if( !error ){
          let data = results;
          let log = ''
          if( Array.isArray(data) && data.filter(obj=>typeof obj === 'object').length === data.length ){
            if( data.length > 0 ){
              let head = Object.keys(data[0]).map(str=>`<th>${str}</th>`).join('');
              let body = data.map(obj=>`<tr>${Object.values(obj).map(str=>`<td>${str}</td>`).join('')}</tr>`).join('')
              log = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`
            } else {
              log = '<p>no result</p>'
            }
          }else {
            log = ''
          }
          res.send(log)
        } else {
          res.send(`<pre><code>${JSON.stringify(error,null,2)}</code></pre>`)
        }
      });
    } else {
      res.send('Error')
    }
  } else {
    res.sendFile(path.join(process.cwd(),'/public/database.html'));
  }
})

app.get('/api/clients/create',(req,res)=>{
  let { clientId , phoneNumber } = req.query //9647705320672
  clientId = parseInt(clientId);
  if( Number.isInteger(clientId) || typeof phoneNumber === 'string' ){
    createNewClient({ clientId , phoneNumber },(log)=>{
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
    getChatsAsync({ clientId }).then(log=>{
      res.json(log)
    }).catch(error=>res.json({ 'status':403,'error':{ 'message':error.message } }))
    
  } else {
    res.json({ 'status':403,'error':{ 'message':`client id is not valid` } });
  }
})
app.get('/api/client/logout',(req,res)=>{
  let { } = req.query
  clientLogoutAsync({}).then(log=>{
    res.json(log)
  }).catch(error=>res.json({ 'status':403,'error':{ 'message':error.message } }))
})
app.get('/api/clients/state',async(req,res)=>{
  let [ error1 , exportsState ] = await database.queryAsync({ sql:`
    SELECT 
      clientUniqeId, GROUP_CONCAT(DISTINCT exportedDateTime) AS exportedDateTimes
    FROM messageslogs
      WHERE exportedDateTime IS NOT NULL
      GROUP BY clientUniqeId;
  ` })
  //
  exportsState = error1?[]:exportsState;
  let exportedData = {};
  for( let i in exportsState){
    let { clientUniqeId , exportedDateTimes } = exportsState[i];
    exportedDateTimes = exportedDateTimes.split(',')
    for( let x in exportedDateTimes ){
      let exportedDateTime = exportedDateTimes[x];
      exportedData[clientUniqeId] = exportedData[clientUniqeId] || []
      exportedData[clientUniqeId].push({ exportedDateTime,exportedDateTimeString:fun.getDatetimeString(parseInt(exportedDateTime)) }) 
    }
   
  }
  //
  database.query({ sql:`
    SELECT * , id as clientId FROM clients WHERE statusId = 1;
  ` },async(error,result)=>{
    if( !error ){
      let clients = result.map((row)=>{
        row.lastActiveDateTimeString        = fun.getDatetimeString(row.lastActiveDateTime)
        row.createdDateTimeString           = fun.getDatetimeString(row.createdDateTime)
        row.lastCollectedLogDateTimeString  = Number.isInteger(row.lastCollectedLogDateTime)?fun.getDatetimeString(row.lastCollectedLogDateTime):'NULL'
        row.exportedDates                   = exportedData[row.clientUniqeId] || []
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

app.get('/files/exported/:clientUniqeId/:exportedDateTime',(req,res)=>{
  let { 'params':{ clientUniqeId , exportedDateTime } } = req;
  exportedDateTime = typeof exportedDateTime === 'string'?exportedDateTime:'';
  exportedDateTime = exportedDateTime.replace('.xlsx','')
  exportedDateTime = parseInt(exportedDateTime)
  if( typeof clientUniqeId === 'string' && Number.isInteger(exportedDateTime) ){
    exportToExcelFileAsync({ clientUniqeId,exportedDateTime }).then(async log=>{
      if( log.status === 200 ){
        // res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        // res.setHeader('Content-Length', log.data.buffer.length);
        let { fileName , workbook } = log.data;
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        await workbook.xlsx.write(res);
        res.end()
      } else {
        res.send('Error: '+log.error.message  )
      }
    }).catch(error=>{
      res.send(error.message)
    })
  } else {
    res.send('Error')
  }
})

// Start the server
app.listen(port, () => {
  exec(`start http://localhost:${port}/`); 
  console.log(`Server running at http://localhost:${port}/`);
});

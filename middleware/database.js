const sqlite3 = require('sqlite3').verbose();
const path = require('path')
const mysql = require('mysql');


//
function getConnection(params={},callback=()=>{}){
  let connection = new sqlite3.Database(path.resolve(__dirname,'../databases/oglaa.db'),(error)=>{
    if( !error ){
      callback(null,connection)
    } else { callback(error,null) }
  })
}


function query(params={},callback=()=>{}){
  let { connection , sql } = params;
  if( connection ){
  //
    if( sql.includes('CREATE TABLE') ){
      connection.exec(sql,(error)=>{
        if( !error ){
          callback(null,{})
        } else {
          callback(error,{})
        }
      })
    } else if( sql.includes('INSERT INTO ') || sql.includes('UPDATE ') ){
      connection.run(sql,[],(error,result)=>{
        callback(error,result)
      })
    } else {
      connection.all(sql,[],(error,result)=>{
        callback(error,result)
      })
    }
  } else {
    getConnection({},(error,connection)=>{
      if( !error ){
        query({ ...params , connection },(...log)=>{
          connection.close();
          callback(...log);
        })
      } else {
        callback(error)
      }
    })
  }
}
const queryAsync = (params={})=>new Promise((rs,rj)=>query(params,(...log)=>rs(log)));


function __main(params={}) {
  // query({ sql:`DROP TABLE messageslogs` },console.log)
  // query({
  //   sql:`SELECT name FROM sqlite_master WHERE type='table'`
  // },(error,tables)=>{
  //   if( !error ){
  //     if( tables.length !== 3 ){
  //       query({ sql:`
  //         CREATE TABLE IF NOT EXISTS messageslogs (
  //             id INTEGER PRIMARY KEY AUTOINCREMENT,
  //             message TEXT,
  //             messageDateTime INTEGER,
  //             clientUniqeId  VARCHAR(255),
  //             senderUniqeId  VARCHAR(255),
  //             chatUniqeId VARCHAR(255),
  //             fromClient  INTEGER,
  //             isExported  INTEGER DEFAULT NULL,
  //             exportedFile  VARCHAR(100) DEFAULT NULL
  //         );
  //         CREATE UNIQUE INDEX IF NOT EXISTS id_uniqe_message ON messageslogs (messageDateTime, clientUniqeId, chatUniqeId, fromClient);
  //         CREATE TABLE IF NOT EXISTS clients (
  //           id INTEGER PRIMARY KEY AUTOINCREMENT,
  //           lastActiveDateTime INTEGER,
  //           lastCollectedLogDateTime INTEGER DEFAULT NULL,
  //           clientUniqeId VARCHAR(50),
  //           createdDateTime INTEGER
  //         );
  //       ` },(error,field)=>{
  //         console.log(error,field)
  //       })
  //     } else {
  //       console.log(tables)
  //     }
  //   }
  // })
}

// __main()

/*
DROP TABLE messageslogs;
CREATE TABLE IF NOT EXISTS messageslogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clientUniqeId  VARCHAR(255),
    fromClient  INTEGER,
    chatUniqeId VARCHAR(255),
    senderUniqeId  VARCHAR(255),
    message TEXT,
    messageType VARCHAR(30),
    messageDateTime INTEGER,
    exportedDateTime INTEGER DEFAULT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS id_uniqe_message ON messageslogs (messageDateTime, clientUniqeId, chatUniqeId, fromClient);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lastActiveDateTime INTEGER,
  lastCollectedLogDateTime INTEGER DEFAULT NULL,
  clientUniqeId VARCHAR(50),
  createdDateTime INTEGER
);
DROP TABLE members;
CREATE TABLE members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clientUniqeId  VARCHAR(255),
  memberUniqeId VARCHAR(255),
  name VARCHAR(255),
  pushname VARCHAR(255),
  type INTEGER,
  createdDateTime INTEGER
);
*/ 
module.exports = {
  query,
  queryAsync,
  getConnection,
  'format':mysql.format,
}
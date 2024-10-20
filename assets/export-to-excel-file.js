const ExcelJS = require('exceljs');
const database = require('../middleware/database');
const { getDatetimeString } = require('../middleware/fun');

function cellAlign(params={}) {
  let { cell , horizontal='center',vertical='top' ,  wrapText=false } = params;
  cell.alignment = { horizontal,vertical , wrapText }
}
function cellColoring(params) {
  let { cell , color, backgroundColor , isOdd } = params;
  if( typeof isOdd === 'boolean' ){
    color = isOdd?'FF000000':'FF000000'
    backgroundColor = isOdd?'FFFFFFFF':'FFBBBBBB'
  }
  //
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: backgroundColor }  // Green background color
  };
  
  // Set the text color (Red)
  cell.font = {
    color: { argb:color }  // Red text color
  };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FF000000' } },    // Top border
    left: { style: 'thin', color: { argb: 'FF000000' } },   // Left border
    bottom: { style: 'thin', color: { argb: 'FF000000' } }, // Bottom border
    right: { style: 'thin', color: { argb: 'FF000000' } }    // Right border
  };
}

async function exportToExcelFileAsync(params={},options={},callback=()=>{}){
  let { clientUniqeId , exportedDateTime  } = params;
  let [ error1 , messageslogs ] = await database.queryAsync({ 'sql':database.format(
    `SELECT * FROM messageslogs WHERE clientUniqeId = ? AND exportedDateTime = ? `,
    [clientUniqeId , exportedDateTime]
  )}) // ORDER BY chatUniqeId,messageDateTime DESC
  console.log(messageslogs.length,clientUniqeId,exportedDateTime)
  if( !error1 && Array.isArray(messageslogs) ){
    let [ error2 , members ] = await database.queryAsync({ 'sql':database.format(
      `SELECT name , pushname , memberUniqeId FROM members WHERE clientUniqeId = ? `,
      [clientUniqeId]
    )})
    members = Array.isArray(members)?members:[];
    members = Object.assign({},...members.map(member=>({ [member.memberUniqeId]:member })))
    // console.log(members)
    //
    // console.log(messageslogs.length)
    // Create a new workbook and worksheet
    let workbook = new ExcelJS.Workbook();
    let exportedDateTimeString = getDatetimeString(exportedDateTime);
    let worksheet = workbook.addWorksheet('Sheet 1');
    //
    // id	clientUniqeId	fromClient	chatUniqeId	senderUniqeId	message	messageType	messageDateTime	exportedDateTime
    let log = {};
    for( let index in messageslogs ){
      let row = messageslogs[index]
      let { fromClient , chatUniqeId , senderUniqeId , message ,	messageType	, messageDateTime } = row;
      log[chatUniqeId] = log[chatUniqeId] || { messages:[] , clientUniqeId , 'no':Object.keys(log).length + 1 }
      log[chatUniqeId].messages.push({ fromClient , senderUniqeId , message ,	messageType	, messageDateTime })
    }
    //
    let columns = [{ name:'No.',width:4 },{ name:'Chat',width:35 },{ name:'Sender',width:40 },{ name:'Messages',width:150 },{ name:'Sent DateTime',width:18 }];
    worksheet.getRow(1).height = 44
    worksheet.views = [{ state: 'frozen', ySplit: 1 }]
    for( let i in columns ){
      let x = parseInt(i) + 1;
      let { name , width } = columns[i];
      worksheet.getColumn(x).width = width
      let cell = worksheet.getCell(1, x);
      cellAlign({ cell , vertical:'middle' });
      cellColoring({ cell,color:'FF000000',backgroundColor:'FFC6EFCE' })
      cell.value = name;
      // cell.fill = { type: 'pattern',pattern: 'solid', fgColor: { argb: 'FF00FF00' } };
    }
    //
    let currentRow = 2;
    let cell = null;
    let isOdd = true
    for( let chatUniqeId in log ){
      let { messages , clientUniqeId , no } = log[chatUniqeId];
      // console.log({ ...log[chatUniqeId] , messages:log[chatUniqeId].messages.length })
      // No.
      worksheet.mergeCells(currentRow, 1, currentRow+messages.length-1, 1);
      cell = worksheet.getCell(currentRow,1);
      cellAlign({ cell });
      cellColoring({ cell,isOdd })
      cell.value = no
      // client
      worksheet.mergeCells(currentRow, 2, currentRow+messages.length-1, 2);
      cell = worksheet.getCell(currentRow,2);
      cellAlign({ cell });
      cellColoring({ cell,isOdd })
      let chatMember = members[chatUniqeId] || {};
      cell.value = {
        text: chatMember.name || chatMember.pushname || `+${chatUniqeId.split('@')[0]}`,
        hyperlink: `https://wa.me/${chatUniqeId.split('@')[0]}`,
      };
      // messages
      for( let i in messages ){
        let y = parseInt(i) + currentRow;
        let { fromClient , senderUniqeId , message ,	messageType	, messageDateTime } = messages[i];
        // sender
        cell = worksheet.getCell(y, 3);
        cellColoring({ cell,isOdd })
        cellAlign({ cell,horizontal:'center',vertical:'top' })
        // cell.value = senderUniqeId;
        let senderMember = members[senderUniqeId] || {};
        cell.value = {
          text: senderMember.name || senderMember.pushname || `+${senderUniqeId.split('@')[0]}`,
          hyperlink: `https://wa.me/${senderUniqeId.split('@')[0]}`,
        };
        // message column
        cell = worksheet.getCell(y, 4);
        cellAlign({ cell,wrapText:true,horizontal:'left',vertical:'middle' })
        cellColoring({ cell,isOdd })
        cell.value = String(message||'').replaceAll('\n',`\r\n`) || (messageType?`<<${messageType}>>`:'');
        // messageDateTime
        cell = worksheet.getCell(y, 5);
        cellColoring({ cell,isOdd })
        cellAlign({ cell,horizontal:'center',vertical:'top' })
        cell.value = getDatetimeString(messageDateTime,'HH:mm:ss YYYY-MM-SS');
      }
      //
      currentRow = currentRow + messages.length;
      isOdd      = !isOdd
    } 
    //
    let fileName = `${clientUniqeId.split('@')[0].replaceAll(':','')} ${getDatetimeString(exportedDateTime,'YYYY-MM-DD HH-mm-ss')}.xlsx`;
    // console.log({fileName})
    // workbook.xlsx.writeFile(fileName)
    // .then(() => {
    //   console.log('Workbook created successfully with merged cells!');
    // })
    // .catch((error) => {
    //   console.log('Error writing workbook:', error);
    // });
    // let buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    return({ 'status':200,'data':{ fileName,workbook } })
  } else {
    console.log({ error1 })
    return({ 'status':403,'error':error1 })
  }
}

// exportToExcelFileAsync({ clientUniqeId:'905419755586@c.us',exportedDateTime:1726351858157 })

module.exports = {
  exportToExcelFileAsync
}
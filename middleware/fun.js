const moment              = require('moment-timezone');


function getDatetimeString(datetime=Date.now(),format='YYYY-MM-DD HH:mm:ss',timeZone='Asia/Baghdad') { // done
  return moment(datetime).tz(timeZone).format(format);
}


module.exports = {
  getDatetimeString
}
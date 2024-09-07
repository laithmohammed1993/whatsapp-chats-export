const { Client , ClientInfo } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
// Create a new client instance
const client = new Client({
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }
});

// When the client is ready, run this code (only once)
client.once('ready',async () => {
    console.log('Client is ready!');
    // client.getChatById({
    //   server: 'c.us',
    //   user: '447834734063',
    //   _serialized: '447834734063@c.us'
    // }._serialized).then(console.log).catch(console.log)
    let chatId = '447834734063@c.us';
        
    let chat = await client.getChatById(chatId);
    
    // Fetch messages from the chat
    let messages = await chat.fetchMessages({ limit: 50 }); // Limit to the last 50 messages

    // Display the messages
    messages.forEach(message => {
        console.log(`From: ${message.from}`);
        console.log(`To: ${message.to}`);
        console.log(`Message: ${message.body}`);
        console.log('---');
    });
});

// When the client received QR-Code
client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, {small: true});
});
Client.C
client.on('message_create', message => {
	console.log(`${message.from} : ${message.body}`);
});
// Start your client
client.initialize();

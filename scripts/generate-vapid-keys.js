const webPush = require('web-push');

const keys = webPush.generateVAPIDKeys();

console.log('Cadastre estas variáveis somente no ambiente do backend:');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:suporte@tradesports.com.br');

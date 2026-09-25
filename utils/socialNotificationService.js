const User=require('../models/User');
const {enviarPushParaUsuario}=require('../services/pushNotificationService');
function id(prefix='notif'){return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;}
async function notify(usuarioId,{tipo,title,body='',targetUrl='',metadata={}}){const notificacao={id:id('social'),title,body,read:false,createdAt:new Date(),metadata:{tipo,targetUrl,...metadata}};const resultado=await User.updateOne({_id:usuarioId},{$push:{notificacoes:{$each:[notificacao],$position:0,$slice:100}}});if(!resultado.matchedCount)return null;enviarPushParaUsuario(usuarioId,notificacao).catch((erro)=>console.error('[WEB PUSH] erro não bloqueante:',erro?.message));return notificacao;}
module.exports={notify};

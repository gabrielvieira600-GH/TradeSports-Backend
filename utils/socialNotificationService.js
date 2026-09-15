const User=require('../models/User');
function id(prefix='notif'){return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;}
async function notify(usuarioId,{tipo,title,body='',targetUrl='',metadata={}}){const u=await User.findById(usuarioId);if(!u)return null;u.notificacoes=Array.isArray(u.notificacoes)?u.notificacoes:[];u.notificacoes.unshift({id:id('social'),title,body,read:false,createdAt:new Date(),metadata:{tipo,targetUrl,...metadata}});u.notificacoes=u.notificacoes.slice(0,100);u.markModified('notificacoes');await u.save();return u.notificacoes[0];}
module.exports={notify};

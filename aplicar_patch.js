const fs=require('fs');
const p='routes/usuario.js',f='services/accountDeletionPremium.js';
if(!fs.existsSync(p)||!fs.existsSync(__dirname+'/'+f))throw Error('Copie todo o conteúdo da pasta backend para a raiz do backend.');
const s=fs.readFileSync(p,'utf8');
const a=s.indexOf("  if(u.premiumAtivo||u.plano==='premium')");
const b=s.indexOf("  const id=String(u._id);",a);
if(a<0||b<0)throw Error('Bloco de exclusão não encontrado; nenhum arquivo alterado.');
const newBlock=`  try {
    await require('../services/accountDeletionPremium').cancelAll(u._id);
  } catch(e) {
    console.error('[EXCLUSAO PREMIUM]',e.message);
    return res.status(409).json({erro:'Não foi possível confirmar o cancelamento da assinatura no Asaas. Sua conta foi mantida. Contate o suporte se persistir.'});
  }
  u.plano='lite';u.premiumAtivo=false;u.premiumFim=new Date();
`;
const updated=s.slice(0,a)+newBlock+s.slice(b);
fs.copyFileSync(p,p+'.bak-premium-exclusao');
if(fs.existsSync(f))fs.copyFileSync(f,f+'.bak-premium-exclusao');
fs.copyFileSync(__dirname+'/'+f,f);
fs.writeFileSync(p,updated);
console.log('Backend atualizado. Backup criado.');

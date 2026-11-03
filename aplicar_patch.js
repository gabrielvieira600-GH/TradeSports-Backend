const fs=require('fs');
function edit(p,fn){if(!fs.existsSync(p))throw Error('Não encontrado: '+p);const s=fs.readFileSync(p,'utf8');const t=fn(s);if(s===t)throw Error('Âncora não encontrada: '+p);fs.copyFileSync(p,p+'.bak-exclusao');fs.writeFileSync(p,t);console.log('Atualizado '+p)}
edit('middleware/auth.js',s=>s.replace('    if (!usuarioDB) {',`    if (usuarioDB?.metadata?.contaExcluidaEm) return res.status(401).json({erro:'Conta excluída.'});
    if (!usuarioDB) {`));
edit('routes/usuario.js',s=>s.replace('module.exports = router;',`
router.delete('/conta',auth,async(req,res)=>{
 try{
  const bcrypt=require('bcrypt');
  const u=await User.findById(req.usuario.id);
  if(!u)return res.status(404).json({erro:'Conta não encontrada.'});
  if(u.admin||u.role==='admin'||u.metadata?.accountType==='INSTITUTIONAL')return res.status(403).json({erro:'Conta administrativa ou institucional.'});
  if(req.body?.confirmacao!=='EXCLUIR MINHA CONTA'||!await bcrypt.compare(String(req.body?.senha||''),u.senha))return res.status(403).json({erro:'Senha ou confirmação inválida.'});
  if(await Order.exists({usuarioId:u._id,status:{$in:['aberta','parcial']}})||(u.carteira||[]).some(c=>Number(c.quantidade)>0))return res.status(409).json({erro:'Cancele suas ordens e venda ou liquide suas cotas antes da exclusão.'});
  if(u.premiumAtivo||u.plano==='premium')return res.status(409).json({erro:'Resolva sua assinatura Premium antes da exclusão. Contate o suporte se necessário.'});
  const mongoose=require('mongoose');
  const subs=await mongoose.connection.db.collection('asaas_premium_subscriptions').find({userId:u._id}).limit(20).toArray();
  if(subs.some(x=>!x.cancelledAt&&!['CANCELLED','EXPIRED','INACTIVE'].includes(String(x.status||'').toUpperCase())))return res.status(409).json({erro:'Há assinatura ou pagamento pendente. Contate o suporte.'});
  const id=String(u._id);
  u.nome='Conta excluída';u.sobrenome='';u.nomeUsuario='excluido_'+id;u.email='excluido_'+id+'@invalid.local';
  u.bio='';u.fotoPerfilUrl='';u.fotoPerfilPublicId='';u.cpf=undefined;u.dataNascimento=null;u.genero=null;
  u.senha=await bcrypt.hash(require('crypto').randomBytes(48).toString('hex'),10);
  u.dadosBancarios=null;u.watchlist={clubes:[],ligas:[]};u.notificacoes=[];u.alertState={};
  u.tokenVerificacao=null;u.tokenVerificacaoHash=null;u.resetSenhaTokenHash=null;u.rankingAtivo=false;
  u.metadata={...(u.metadata||{}),contaExcluidaEm:new Date(),exclusaoSolicitadaPeloUsuario:true};
  await u.save();
  return res.json({ok:true});
 }catch(e){console.error('[EXCLUSAO CONTA]',e);return res.status(500).json({erro:'Falha na exclusão. Contate o suporte.'})}
});
module.exports = router;`));

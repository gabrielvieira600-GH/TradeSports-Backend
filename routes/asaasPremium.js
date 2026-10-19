const express=require('express');
const crypto=require('crypto');
const auth=require('../middleware/auth');
const User=require('../models/User');
const Sub=require('../models/AsaasSubscription');
const Event=require('../models/AsaasEvent');
const asaas=require('../services/asaas');
const router=express.Router();
const price=Number(process.env.ASAAS_PREMIUM_MONTHLY_BRL);
const fail=(res,e)=>{console.error('[ASAAS]',e?.response?.status||e.message);return res.status(502).json({erro:'Serviço de cobrança indisponível.'});};
router.get('/status',auth,async(req,res)=>{
 const sub=await Sub.findOne({userId:req.usuario.id}).sort({createdAt:-1}).lean();
 res.json({subscription:sub?{status:sub.status,billingType:sub.billingType,paidUntil:sub.paidUntil}:null});
});
router.post('/checkout',auth,async(req,res)=>{
 try{
  if(process.env.ASAAS_PREMIUM_ENABLED!=='true')return res.status(503).json({erro:'Assinaturas em preparação.'});
  if(!Number.isFinite(price)||price<=0)return res.status(503).json({erro:'Preço não configurado.'});
  const billingType=req.body?.billingType;
  if(!['PIX','CREDIT_CARD'].includes(billingType))return res.status(400).json({erro:'Forma de pagamento inválida.'});
  const user=await User.findById(req.usuario.id);
  if(!user||!user.emailVerificado)return res.status(403).json({erro:'Conta não verificada.'});
  if(!/^\\d{11}$/.test(String(user.cpf||'').replace(/\\D/g,'')))return res.status(422).json({erro:'Informe CPF válido no perfil antes de assinar.'});
  let existing=await Sub.findOne({userId:user._id,status:{$in:['ACTIVE','PENDING']}}).sort({createdAt:-1});
  if(existing)return res.status(409).json({erro:'Já existe uma assinatura ativa ou pendente. Consulte o status antes de tentar novamente.'});
  const cpf=String(user.cpf).replace(/\\D/g,'');
  const ref=String(user._id);
  const found=await asaas('get','/customers?externalReference='+encodeURIComponent(ref)+'&limit=10');
  let customer=found.data?.find(x=>x.externalReference===ref);
  if(!customer)customer=await asaas('post','/customers',{name:[user.nome,user.sobrenome].filter(Boolean).join(' '),email:user.email,cpfCnpj:cpf,externalReference:ref,notificationDisabled:true});
  // Cartão: a API cria a assinatura, mas o primeiro pagamento deve ser feito
  // no checkout seguro do provedor. Nunca coletar números de cartão neste backend.
  if(billingType==='CREDIT_CARD')return res.status(501).json({erro:'Checkout seguro de cartão ainda não configurado. Nenhuma cobrança criada.'});
  // PIX recorrente comum NÃO é Pix Automático. Não anunciar débito automático.
  return res.status(501).json({erro:'Pix Automático para recebimento requer fluxo de autorização específico do Asaas. Nenhuma cobrança criada.'});
 }catch(e){return fail(res,e);}
});
router.post('/webhook',async(req,res)=>{
 const secret=process.env.ASAAS_WEBHOOK_TOKEN;
 const supplied=req.get('asaas-access-token')||'';
 if(!secret||!supplied||Buffer.byteLength(secret)!==Buffer.byteLength(supplied)||!crypto.timingSafeEqual(Buffer.from(secret),Buffer.from(supplied)))return res.sendStatus(401);
 const ev=req.body;
 if(!ev||typeof ev.id!=='string'||typeof ev.event!=='string')return res.sendStatus(400);
 try{
  const prior=await Event.findOne({eventId:ev.id});
  if(prior)return res.sendStatus(200);
  const payment=ev.payment||{};
  const sub=payment.subscription?await Sub.findOne({subscriptionId:payment.subscription}):null;
  // Sem assinatura vinculada, não conceder Premium.
  if(sub&&['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(ev.event)){
   const paid=await asaas('get','/payments/'+encodeURIComponent(payment.id));
   if(['RECEIVED','CONFIRMED'].includes(paid.status)&&paid.subscription===sub.subscriptionId&&Number(paid.value)===price){
    const now=new Date();
    const base=sub.paidUntil&&sub.paidUntil>now?sub.paidUntil:now;
    const until=new Date(base);until.setUTCMonth(until.getUTCMonth()+1);
    if(sub.lastPaymentId!==payment.id){
     sub.status='ACTIVE';sub.lastPaymentId=payment.id;sub.lastPaidAt=now;sub.paidUntil=until;
     await sub.save();
     await User.updateOne({_id:sub.userId},{$set:{plano:'premium',premiumAtivo:true,premiumInicio:now,premiumFim:until}});
    }
   }
  }
  await Event.create({eventId:ev.id});
  return res.sendStatus(200);
 }catch(e){if(e.code===11000)return res.sendStatus(200);console.error('[ASAAS WEBHOOK]',e.message);return res.sendStatus(500);}
});
module.exports=router;

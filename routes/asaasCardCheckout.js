const express=require('express');
const crypto=require('crypto');
const auth=require('../middleware/auth');
const User=require('../models/User');
const Sub=require('../models/AsaasSubscription');
const Checkout=require('../models/AsaasCheckoutIntent');
const asaas=require('../services/asaas');
const router=express.Router();
const FRONTEND=(process.env.TRADESPORTS_FRONTEND_URL||'https://www.tradesports.com.br').replace(/\/$/,'');
const link=id=>'https://asaas.com/checkoutSession/show?id='+encodeURIComponent(id);
router.post('/start',auth,async(req,res)=>{
 try{
  if(process.env.ASAAS_ENV!=='sandbox'||process.env.ASAAS_PREMIUM_ENABLED!=='true')
   return res.status(503).json({erro:'Checkout disponível apenas no Sandbox.'});
  const user=await User.findById(req.usuario.id).select('_id');
  if(!user)return res.sendStatus(401);
  const active=await Sub.findOne({userId:user._id,cancelledAt:null,status:{$in:['ACTIVE','PENDING']}});
  const paid=await Sub.exists({userId:user._id,paidUntil:{$gt:new Date()},status:{$ne:'REVOKED'}});
  if(active||paid)return res.status(409).json({erro:'Assinatura pendente ou período Premium vigente.'});
  const current=await Checkout.findOne({userId:user._id,status:'ACTIVE',expiresAt:{$gt:new Date()}});
  if(current)return res.json({checkoutId:current.checkoutId,url:link(current.checkoutId)});
  const orderId=crypto.randomUUID();
  const nextDueDate=new Date(Date.now()+86400000).toISOString().slice(0,19).replace('T',' ');
  const payload={
   billingTypes:['CREDIT_CARD'],chargeTypes:['RECURRENT'],minutesToExpire:60,
   externalReference:orderId,
   callback:{
    successUrl:FRONTEND+'/checkout/premium?retorno=sucesso',
    cancelUrl:FRONTEND+'/checkout/premium?retorno=cancelado',
    expiredUrl:FRONTEND+'/checkout/premium?retorno=expirado'
   },
   items:[{name:'TradeSports Premium',description:'Assinatura mensal Premium',quantity:1,value:9.90}],
   subscription:{cycle:'MONTHLY',nextDueDate}
   // Sem customer e sem customerData: Asaas coleta os dados necessários.
  };
  let checkout;
  try{checkout=await asaas('post','/checkouts',payload);}
  catch(e){
   const errors=(e.response?.data?.errors||[]).map(x=>({code:String(x.code||'').slice(0,80),description:String(x.description||'').slice(0,350)}));
   console.error('[ASAAS CHECKOUT VALIDATION]',JSON.stringify({status:e.response?.status||null,errors}));
   if(e.response?.status===400)return res.status(422).json({erro:'O Asaas rejeitou o checkout. Consulte ASAAS CHECKOUT VALIDATION no Render.'});
   throw e;
  }
  if(!checkout?.id||!/^[a-zA-Z0-9-]{8,100}$/.test(checkout.id))
   return res.status(502).json({erro:'Asaas não retornou identificador válido.'});
  await Checkout.create({userId:user._id,checkoutId:checkout.id,orderId,expiresAt:new Date(Date.now()+3600000)});
  return res.status(201).json({checkoutId:checkout.id,url:link(checkout.id)});
 }catch(e){
  console.error('[ASAAS CARD CHECKOUT]',e.response?.status||e.code||e.message);
  return res.status(502).json({erro:'Não foi possível abrir o checkout seguro do cartão.'});
 }
});
module.exports=router;

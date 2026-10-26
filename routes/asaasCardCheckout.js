'use strict';
const express=require('express');
const crypto=require('crypto');
const auth=require('../middleware/auth');
const User=require('../models/User');
const Sub=require('../models/AsaasSubscription');
const Intent=require('../models/AsaasCheckoutIntent');
const asaas=require('../services/asaas');
const router=express.Router();
const FRONTEND=(process.env.TRADESPORTS_FRONTEND_URL||'https://www.tradesports.com.br').replace(/\/$/,'');
router.post('/start',auth,async(req,res)=>{
 try{
  if(process.env.ASAAS_PREMIUM_ENABLED!=='true'||!['sandbox','production'].includes(process.env.ASAAS_ENV))return res.sendStatus(503);
  const user=await User.findById(req.usuario.id).select('_id');if(!user)return res.sendStatus(401);
  if(await Sub.exists({userId:user._id,cancelledAt:null,status:{$in:['PENDING','ACTIVE']}})||await Sub.exists({userId:user._id,paidUntil:{$gt:new Date()},status:{$ne:'REVOKED'}}))return res.status(409).json({erro:'Assinatura pendente ou Premium vigente.'});
  const orderId=crypto.randomUUID();
  const payload={billingTypes:['CREDIT_CARD'],chargeTypes:['RECURRENT'],minutesToExpire:60,externalReference:orderId,
   callback:{successUrl:FRONTEND+'/checkout/premium?retorno=sucesso',cancelUrl:FRONTEND+'/checkout/premium?retorno=cancelado',expiredUrl:FRONTEND+'/checkout/premium?retorno=expirado'},
   items:[{name:'TradeSports Premium',description:'Assinatura mensal Premium',quantity:1,value:9.90}],
   subscription:{cycle:'MONTHLY',nextDueDate:new Date(Date.now()+86400000).toISOString().slice(0,19).replace('T',' ')}
  };
  const checkout=await asaas('post','/checkouts',payload);
  if(!checkout?.id||!/^[a-zA-Z0-9-]{8,100}$/.test(checkout.id))throw new Error('Checkout inválido');
  await Intent.create({userId:user._id,checkoutId:checkout.id,orderId,status:'ACTIVE',expiresAt:new Date(Date.now()+3600000)});
  const host=process.env.ASAAS_ENV==='production'?'https://www.asaas.com':'https://sandbox.asaas.com';
  return res.status(201).json({checkoutId:checkout.id,url:host+'/checkoutSession/show/'+encodeURIComponent(checkout.id)});
 }catch(e){console.error('[ASAAS CARD CHECKOUT]',e.response?.status||e.message);return res.status(502).json({erro:'Não foi possível iniciar checkout seguro.'});}
});
module.exports=router;

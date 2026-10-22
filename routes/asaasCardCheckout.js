const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Sub = require('../models/AsaasSubscription');
const asaas = require('../services/asaas');
const {validCpf} = require('../utils/cpf');
const router = express.Router();
const FRONTEND = (process.env.TRADESPORTS_FRONTEND_URL || 'https://www.tradesports.com.br').replace(/\/$/, '');

router.post('/start',auth,async(req,res)=>{
 try {
  if(process.env.ASAAS_ENV!=='sandbox'||process.env.ASAAS_PREMIUM_ENABLED!=='true')
   return res.status(503).json({erro:'Checkout de cartão disponível somente no Sandbox.'});
  const user=await User.findById(req.usuario.id);
  if(!user)return res.sendStatus(401);
  const cpf=String(user.cpf||'').replace(/\D/g,'');
  if(!validCpf(cpf))return res.status(422).json({erro:'Atualize seu CPF em Dados de faturamento.'});
  const active=await Sub.findOne({userId:user._id,cancelledAt:null,status:{$in:['ACTIVE','PENDING']}});
  const paid=await Sub.exists({userId:user._id,paidUntil:{$gt:new Date()},status:{$ne:'REVOKED'}});
  if(active||paid)return res.status(409).json({erro:'Existe assinatura pendente ou período Premium vigente.'});
  const ref=String(user._id);
  const result=await asaas('get','/customers?externalReference='+encodeURIComponent(ref)+'&limit=100');
  let customer=result.data?.find(c=>c.externalReference===ref);
  if(!customer)customer=await asaas('post','/customers',{
   name:[user.nome,user.sobrenome].filter(Boolean).join(' ')||user.nomeUsuario,
   email:user.email,cpfCnpj:cpf,externalReference:ref,notificationDisabled:true
  });
  const nextDueDate=new Date(Date.now()+24*60*60*1000).toISOString().slice(0,19).replace('T',' ');
  const payload={
   billingTypes:['CREDIT_CARD'],chargeTypes:['RECURRENT'],minutesToExpire:60,
   externalReference:ref,customer:customer.id,
   callback:{
    successUrl:FRONTEND+'/checkout/premium?retorno=sucesso',
    cancelUrl:FRONTEND+'/checkout/premium?retorno=cancelado',
    expiredUrl:FRONTEND+'/checkout/premium?retorno=expirado'
   },
   items:[{name:'TradeSports Premium',description:'Assinatura mensal Premium',quantity:1,value:9.90}],
   subscription:{cycle:'MONTHLY',nextDueDate}
  };
  let checkout;
  try{checkout=await asaas('post','/checkouts',payload);}
  catch(e){
   const errors=Array.isArray(e.response?.data?.errors)?e.response.data.errors.map(x=>({
    code:String(x.code||'').slice(0,80),description:String(x.description||'').slice(0,400)
   })):[];
   console.error('[ASAAS CHECKOUT VALIDATION]',JSON.stringify({status:e.response?.status||null,errors}));
   if(e.response?.status===400)return res.status(422).json({
    erro:'O Asaas rejeitou os dados do checkout. Consulte [ASAAS CHECKOUT VALIDATION] nos logs do Render.',
    codigo:'ASAAS_CHECKOUT_VALIDATION'
   });
   throw e;
  }
  if(!checkout.id||!/^[a-zA-Z0-9-]{8,100}$/.test(checkout.id))
   return res.status(502).json({erro:'Asaas não retornou um ID válido de checkout.'});
  return res.json({checkoutId:checkout.id,url:'https://asaas.com/checkoutSession/show?id='+encodeURIComponent(checkout.id)});
 }catch(e){
  console.error('[ASAAS CARD CHECKOUT]',e.response?.status||e.code||e.message);
  return res.status(502).json({erro:'Não foi possível abrir o checkout seguro do cartão.'});
 }
});
module.exports=router;

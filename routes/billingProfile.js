const express=require('express');
const bcrypt=require('bcrypt');
const rateLimit=require('express-rate-limit');
const auth=require('../middleware/auth');
const User=require('../models/User');
const Sub=require('../models/AsaasSubscription');
const {onlyDigits,validCpf,maskCpf}=require('../utils/cpf');
const router=express.Router();
const limiter=rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:'draft-7',legacyHeaders:false,
 message:{erro:'Muitas tentativas. Aguarde 15 minutos.'}});
router.get('/',auth,async(req,res)=>{
 try{
  const user=await User.findById(req.usuario.id).select('cpf').lean();
  if(!user)return res.status(404).json({erro:'Usuário não encontrado.'});
  return res.set('Cache-Control','no-store').json({cpfMascarado:maskCpf(user.cpf),cpfCadastrado:Boolean(user.cpf),cpfValido:validCpf(user.cpf)});
 }catch(e){console.error('[BILLING PROFILE] leitura',e.code||e.message);return res.status(500).json({erro:'Falha ao consultar os dados de faturamento.'});}
});
router.put('/',auth,limiter,async(req,res)=>{
 try{
  const cpf=onlyDigits(req.body?.cpf);
  const senha=String(req.body?.senhaAtual||'');
  if(!validCpf(cpf))return res.status(422).json({erro:'CPF inválido. Confira os dígitos verificadores.'});
  if(!senha)return res.status(422).json({erro:'Informe sua senha atual para confirmar a alteração.'});
  const user=await User.findById(req.usuario.id).select('+senha cpf');
  if(!user)return res.status(404).json({erro:'Usuário não encontrado.'});
  const matches=await bcrypt.compare(senha,user.senha);
  if(!matches)return res.status(403).json({erro:'Senha atual incorreta.'});
  const current=onlyDigits(user.cpf);
  if(current===cpf)return res.json({ok:true,cpfMascarado:maskCpf(cpf),cpfValido:true});
  const duplicate=await User.exists({_id:{$ne:user._id},cpf});
  if(duplicate)return res.status(409).json({erro:'Este CPF já está cadastrado em outra conta.'});
  const subscription=await Sub.findOne({userId:user._id,customerId:{$exists:true,$nin:['',null]}}).sort({createdAt:-1}).lean();
  if(subscription){
   return res.status(409).json({erro:'Este CPF está associado a um cadastro de cobrança no Asaas. Solicite a alteração ao suporte para sincronizar os dados com segurança.'});
  }
  user.cpf=cpf;
  await user.save();
  return res.set('Cache-Control','no-store').json({ok:true,cpfMascarado:maskCpf(cpf),cpfValido:true});
 }catch(e){
  if(e.code===11000)return res.status(409).json({erro:'Este CPF já está em uso.'});
  console.error('[BILLING PROFILE] atualização',e.code||e.name);
  return res.status(500).json({erro:'Não foi possível salvar o CPF.'});
 }
});
module.exports=router;

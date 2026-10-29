'use strict';
// Executar na raiz do BACKEND: node aplicar_correcao.js
const fs = require('fs');
const crypto = require('crypto');
const paths = ['models/RecoveryRecharge.js','routes/recoveryRecharge.js','services/asaas.js'];
function replaceOne(text,needle,replacement,label){
 const first=text.indexOf(needle);
 if(first<0||text.indexOf(needle,first+needle.length)>=0)throw Error('Trecho ausente ou repetido: '+label);
 return text.slice(0,first)+replacement+text.slice(first+needle.length);
}
function run(){
 const original = Object.fromEntries(paths.map(p=>{if(!fs.existsSync(p))throw Error('Arquivo ausente: '+p+'. Execute na raiz do backend.');return [p,fs.readFileSync(p,'utf8')]}));
 if(original[paths[0]].includes('RECOVERY_INDEX_FIX_V1')){console.log('Correção já aplicada.');return;}
 const changed={...original};
 changed[paths[0]]=replaceOne(changed[paths[0]],
 "pagamentoId: { type: String, default: null, unique: true, sparse: true, index: true },",
 "// RECOVERY_INDEX_FIX_V1: IDs só existem após checkout criado.\n    pagamentoId: { type: String, default: undefined },",
 'schema pagamentoId');
 changed[paths[0]]=replaceOne(changed[paths[0]],
 'RecoveryRechargeSchema.index({ usuarioId: 1, status: 1, createdAt: -1 });',
 `RecoveryRechargeSchema.index({ usuarioId: 1, status: 1, createdAt: -1 });
// Índice parcial ignora documentos sem ID ou com ID nulo.
RecoveryRechargeSchema.index(
  { pagamentoId: 1 },
  { name: 'pagamentoId_1', unique: true,
    partialFilterExpression: { pagamentoId: { $type: 'string' } } }
);`, 'índice parcial');
 // O checkout ainda pode falhar por validação de conta/payload: expor apenas
 // descrição sanitizada nos logs do Render, sem expor resposta completa ou PII.
 changed[paths[2]]=replaceOne(changed[paths[2]],
 "? err.response.data.errors.map(x => ({code: String(x.code || '').slice(0,80)}))",
 "? err.response.data.errors.map(x => ({code: String(x.code || '').slice(0,80), description: String(x.description || '').replace(/[\\r\\n]/g,' ').slice(0,350)}))",
 'diagnóstico Asaas');
 // Evitar gravar pagamentoId null em novos registros, mesmo se schema antigo ainda
 // estiver em cache durante um rollout.
 changed[paths[1]]=replaceOne(changed[paths[1]],
 "recharge.pagamentoId=checkout.id;await recharge.save();",
 "recharge.pagamentoId=checkout.id;await recharge.save();",
 'confirmação de checkout');
 const backups=[];
 try{
  for(const p of paths){const b=p+'.bak-'+crypto.randomBytes(4).toString('hex');fs.copyFileSync(p,b,fs.constants.COPYFILE_EXCL);backups.push([p,b]);}
  for(const p of paths)fs.writeFileSync(p,changed[p]);
  console.log('Arquivos atualizados:',paths.join(', '));
  console.log('Backups:',backups.map(x=>x[1]).join(', '));
  console.log('ATENÇÃO: execute a migração de índice antes do próximo teste.');
 }catch(e){for(const [p,b] of backups){if(fs.existsSync(b))fs.copyFileSync(b,p);}throw e;}
}
try{run();}catch(e){console.error(e.message);process.exitCode=1;}

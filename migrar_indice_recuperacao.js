'use strict';
/* Executar na raiz do BACKEND, com a URI MongoDB correta no ambiente.
   node migrar_indice_recuperacao.js          => diagnóstico (não altera)
   node migrar_indice_recuperacao.js --apply  => migração
   NUNCA colar credenciais em mensagens ou logs.
*/
const mongoose=require('mongoose');
const uri=process.env.MONGODB_URI||process.env.MONGO_URI;
async function main(){
 if(!uri)throw Error('MONGODB_URI/MONGO_URI ausente. Confira o nome usado pelo backend.');
 await mongoose.connect(uri,{serverSelectionTimeoutMS:10000});
 const col=mongoose.connection.db.collection('recovery_recharges');
 const indexes=await col.indexes();
 const idx=indexes.find(i=>i.name==='pagamentoId_1');
 const nullCount=await col.countDocuments({pagamentoId:null});
 const explicitNull=await col.countDocuments({pagamentoId:{$type:'null'}});
 const duplicateIds=await col.aggregate([
  {$match:{pagamentoId:{$type:'string'}}},
  {$group:{_id:'$pagamentoId',n:{$sum:1}}},
  {$match:{n:{$gt:1}}},{$limit:5}
 ]).toArray();
 console.log(JSON.stringify({database:mongoose.connection.db.databaseName,index:idx?{name:idx.name,unique:idx.unique,sparse:idx.sparse,partialFilterExpression:idx.partialFilterExpression}:null,semPagamentoId:nullCount,nulosExplicitos:explicitNull,idsDuplicados:duplicateIds.length},null,2));
 if(duplicateIds.length)throw Error('Há IDs de pagamento duplicados. Migração interrompida.');
 if(!process.argv.includes('--apply')){console.log('DRY RUN: nenhuma alteração feita. Use --apply após conferir o banco.');return;}
 // Para evitar recriação automática do índice antigo, faça a migração ANTES
 // de publicar o schema novo, com a aplicação pausada para escritas nessa coleção.
 if(explicitNull){const result=await col.updateMany({pagamentoId:{$type:'null'}},{$unset:{pagamentoId:''}});console.log('Campos nulos removidos:',result.modifiedCount);}
 const desired={pagamentoId:{$type:'string'}};
 const correct=idx?.unique===true&&JSON.stringify(idx.partialFilterExpression)===JSON.stringify(desired);
 if(!correct){if(idx){await col.dropIndex('pagamentoId_1');console.log('Índice antigo removido.');}
  await col.createIndex({pagamentoId:1},{name:'pagamentoId_1',unique:true,partialFilterExpression:desired});console.log('Índice parcial criado.');}
 else console.log('Índice parcial já correto.');
}
main().catch(e=>{console.error('ERRO:',e.message);process.exitCode=1;}).finally(()=>mongoose.disconnect());

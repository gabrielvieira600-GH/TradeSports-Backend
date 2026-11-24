'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {seasonValues,currentSeasonFilter,assertCurrentRoster}=require('../files/utils/currentSeasonScope');
const market={id:'premier-league',season:2026,participantes:20};
const docs=Array.from({length:20},(_,i)=>({legacyId:3900000+i+1,metadata:{ligaId:'premier-league',temporada:2026,providerTeamId:i+1}}));
test('aceita 20 clubes válidos da temporada atual',()=>assert.equal(assertCurrentRoster(docs,market),true));
test('mantém o filtro por liga e por temporada numérica ou string',()=>{
 assert.deepEqual(seasonValues('2026'),[2026,'2026']);
 assert.deepEqual(currentSeasonFilter(market),{'metadata.ligaId':'premier-league','metadata.temporada':{$in:[2026,'2026']}});
});
test('não aceita 25 clubes misturando 5 registros históricos',()=>{
 const old=Array.from({length:5},(_,i)=>({legacyId:3900200+i,metadata:{ligaId:'premier-league',temporada:2023,providerTeamId:500+i}}));
 assert.throws(()=>assertCurrentRoster([...docs,...old],market),/INCOMPLETO/);
 assert.equal(assertCurrentRoster([...docs],market),true);
});
test('rejeita clube antigo apresentado como atual',()=>{
 const updated=structuredClone(docs);updated[1].metadata.temporada=2023;
 assert.throws(()=>assertCurrentRoster(updated,market),/FORA_TEMPORADA/);
});
test('rejeita provider ID duplicado',()=>{
 const updated=structuredClone(docs);updated[1].metadata.providerTeamId=1;
 assert.throws(()=>assertCurrentRoster(updated,market),/DUPLICADOS/);
});
test('rejeita legacy ID duplicado',()=>{
 const updated=structuredClone(docs);updated[1].legacyId=3900001;
 assert.throws(()=>assertCurrentRoster(updated,market),/DUPLICADOS/);
});
test('rejeita elenco incompleto',()=>assert.throws(()=>assertCurrentRoster(docs.slice(1),market),/INCOMPLETO/));
test('rejeita temporada inválida',()=>assert.throws(()=>seasonValues('2025/26'),/TEMPORADA_INVALIDA/));

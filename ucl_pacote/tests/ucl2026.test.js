'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ucl=require('../scripts/ucl2026');
test('36 participantes, slots e legacyIds distintos',()=>{
 assert.equal(ucl.roster.length,36);
 assert.equal(new Set(ucl.roster.map(x=>x.slot)).size,36);
 assert.equal(new Set(ucl.roster.map(ucl.toLegacyId)).size,36);
});
test('variações de nomes dos principais participantes',()=>{
 for(const [name,expected] of [['Bodø/Glimt',7],['Bodoe/Glimt',7],['Club Brugge KV',9],['FC Porto',24],['PSV Eindhoven',25],['Paris Saint Germain',23],['Galatasaray Istanbul',13],['Sabah Masazir',29],['VfB Stuttgart',34],['Sporting Lisbon',33]]){
  assert.equal(ucl.identify(name)?.slot,expected,name);
 }
});
test('aceita apenas 36 clubes distintos com posições válidas',()=>{
 const full=ucl.roster.map((x,i)=>({nome:x.nome,posicao:i+1,apiId:i+100,escudo:`https://example.com/${i}.png`}));
 assert.equal(ucl.validateStandings(full).length,36);
 assert.throws(()=>ucl.validateStandings(full.slice(0,35)),/36/);
 assert.throws(()=>ucl.validateStandings(full.map((x,i)=>i===2?{...x,posicao:1}:x)),/repetida/);
 assert.throws(()=>ucl.validateStandings(full.map((x,i)=>i===2?{...x,nome:'Desconhecido FC'}:x)),/não reconhecido/);
 assert.throws(()=>ucl.validateStandings(full.map((x,i)=>i===2?{...x,apiId:0}:x)),/ID da API/);
});
test('não aceita classificação de etapa incompleta',()=>{
 assert.throws(()=>ucl.selectStandings([new Array(18).fill({}),new Array(9).fill({})]),/36/);
 assert.equal(ucl.selectStandings([new Array(36).fill({})]).length,36);
});

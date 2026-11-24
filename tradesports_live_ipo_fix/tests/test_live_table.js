'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../files/services/liveFootballTable.js'),'utf8');
const sandbox={module:{exports:{}},exports:{},require(name){
 if(name==='axios')return{};
 if(name==='mongoose')return{};
 if(name==='../models/Club')return{};
 if(name==='../utils/liquidationPrice')return{calcularPrecoPorPosicao:(p,n)=>5*Math.pow(1.05,n-p)};
 if(name==='../config/marketMode')return{getMarketMode:()=> 'IPO'};
 throw Error(name);
},process:{env:{}},Date,Set,Map,Number,String,Math,Error,JSON,console};
vm.runInNewContext(source,sandbox,{filename:'liveFootballTable.js'});
const {buildTable}=sandbox.module.exports;
function c(id,p){return {legacyId:id,nome:'Time '+id,escudo:'',posicao:p,metadata:{providerTeamId:id}};}
function fixture(id,home,away,short='NS',h=null,a=null,round='Regular Season - 1') {return {fixture:{id,date:'2026-11-24T17:00:00Z',status:{short}},league:{round},teams:{home:{id:home},away:{id:away}},goals:{home:h,away:a}};}
const config={id:'test-football',participantes:2};
const roster=[c(1,1),c(2,2)];
let t=buildTable([fixture(1,1,2,'1H',1,0)],roster,config);
assert.equal(t.live,true);assert.equal(t.table[0].apiId,1);assert.equal(t.table[0].pontos,3);
t=buildTable([fixture(1,1,2,'2H',1,1)],roster,config);
assert.equal(t.table.find(a=>a.apiId===1).pontos,1);assert.equal(t.table.find(a=>a.apiId===2).pontos,1);
t=buildTable([fixture(1,1,2,'FT',1,2)],roster,config);
assert.equal(t.table[0].apiId,2);assert.equal(t.live,false);
assert.throws(()=>buildTable([fixture(1,1,2,'1H',null,null)],roster,config),/PLACAR_AO_VIVO_INDISPONIVEL/);
const teams=Array.from({length:36},(_,i)=>c(100+i,i+1));
const matches=[];let id=1;
const arr=teams.map(t=>t.legacyId);
for(let r=0;r<8;r++){
  for(let j=0;j<18;j++)matches.push(fixture(id++,arr[j],arr[35-j],'NS',null,null,`League Stage - ${r+1}`));
  arr.splice(1,0,arr.pop());
}
assert.equal(matches.length,144);
let u=buildTable(matches,teams,{id:'champions-league',participantes:36});
assert.equal(u.table.length,36);
matches[0]=fixture(1,matches[0].teams.home.id,matches[0].teams.away.id,'1H',2,0,'League Stage - 1');
u=buildTable(matches,teams,{id:'champions-league',participantes:36});
assert.equal(u.table[0].pontos,3);
assert.throws(()=>buildTable(matches.slice(0,120),teams,{id:'champions-league',participantes:36}),/PARTIDAS_UCL_INCOMPLETAS/);
console.log('OK: classificação ao vivo, empate, vitória visitante, feed inválido, Champions 36 clubes/144 partidas.');

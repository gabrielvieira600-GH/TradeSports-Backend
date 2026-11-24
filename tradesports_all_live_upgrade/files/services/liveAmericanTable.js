'use strict';
// NBA and NFL: verified standings with an intragame projected ranking overlay.
// Never use fabricated teams or old-season standings as an active quotation.
const axios = require('axios');
const mongoose = require('mongoose');
const Club = require('../models/Club');
const markets = require('../config/sportsMarkets');
const { getMarketMode } = require('../config/marketMode');
const { calcularPrecoPorPosicao } = require('../utils/liquidationPrice');
const cache = new Map();
const flights = new Map();
const TTL_LIVE = 25000;
const TTL_IDLE = 90000;
const liveNFL = new Set(['Q1', 'Q2', 'Q3', 'Q4', 'HT', 'OT']);
function fault(msg) { const e = new Error(msg); e.liveData = true; return e; }
const n = v => Number(v);
function conference(value, sport) {
  const v = String(value || '').toLowerCase();
  if(sport === 'nba') return v.includes('west') ? 'west' : v.includes('east') ? 'east' : null;
  return v.includes('afc') || v.includes('american') ? 'afc' : v.includes('nfc') || v.includes('national') ? 'nfc' : null;
}
function stats(row, sport) {
  if(sport==='nba') return {win: n(row?.win?.total), loss:n(row?.loss?.total), tie:0, official:n(row?.conference?.rank)};
  return {win:n(row?.won ?? row?.win?.total),loss:n(row?.lost ?? row?.loss?.total),tie:n(row?.ties ?? 0),official:n(row?.conference?.rank ?? row?.position ?? row?.rank)};
}
function normalizedRows(rows,sport,season,league) {
  const result = [];
  for (const row of rows) {
    const cf = conference(row?.conference?.name || row?.conference, sport);
    const id = n(row?.team?.id);
    if(!cf || !Number.isSafeInteger(id) || id<=0) continue;
    const rec = stats(row,sport);
    if(![rec.win,rec.loss,rec.tie].every(x=>Number.isInteger(x)&&x>=0)) throw fault('HISTORICO_INCONSISTENTE_'+sport);
    result.push({id,cf,name:String(row.team?.name||''),...rec});
  }
  return result;
}
function liveOverlay(rows,games,sport,season) {
  const copy = rows.map(row=>({...row})); const byId = new Map(copy.map(x=>[x.id,x]));
  let anyLive = false;
  const seen = new Set();
  for(const game of games) {
    const status=String(game?.status?.short??'');
    const isLive = sport==='nba' ? status==='2' : liveNFL.has(status);
    if(!isLive) continue;
    if(game?.season!=null && String(game.season)!==String(season)) continue;
    const gameId=String(game?.id||'');
    if(!gameId || seen.has(gameId)) throw fault('JOGOS_AO_VIVO_DUPLICADOS');
    seen.add(gameId);
    const home=byId.get(n(game?.teams?.home?.id));
    const away=byId.get(n((sport==='nba'?game?.teams?.visitors?.id:game?.teams?.away?.id)));
    if(!home&&!away) continue;
    if(!home||!away) throw fault('JOGO_AO_VIVO_COM_IDENTIDADE_INCOMPLETA');
    const hp=n(sport==='nba'?game?.scores?.home?.points:(game?.scores?.home?.total ?? game?.scores?.home));
    const ap=n(sport==='nba'?game?.scores?.visitors?.points:(game?.scores?.away?.total ?? game?.scores?.away));
    if(!Number.isFinite(hp)||!Number.isFinite(ap)||hp<0||ap<0) throw fault('PLACAR_AO_VIVO_INDISPONIVEL');
    anyLive=true;
    // Projection uses the current scoreboard: 1 win, 1 loss or 1 tie for NFL.
    // NBA tied games have no projected winner until the next score movement.
    if(hp>ap){home.win+=1;away.loss+=1;}
    else if(ap>hp){away.win+=1;home.loss+=1;}
    else if(sport==='nfl'){home.tie+=1;away.tie+=1;}
  }
  return {rows:copy, live:anyLive};
}
function rankRows(rows,hasLive) {
  const group = new Map();
  for(const r of rows){ if(!group.has(r.cf)) group.set(r.cf,[]); group.get(r.cf).push(r); }
  for(const entries of group.values()){
    if(hasLive){
      // Provisional ranking, not an official tie-break calculation. Keep the official
      // relative order on ties; do not claim that NFL multi-team tie-breaks are exact.
      entries.sort((a,b)=>{
        const pa=(a.win+a.tie*0.5)/Math.max(1,a.win+a.loss+a.tie);
        const pb=(b.win+b.tie*0.5)/Math.max(1,b.win+b.loss+b.tie);
        return pb-pa || a.official-b.official || a.id-b.id;
      });
    } else entries.sort((a,b)=>a.official-b.official || a.id-b.id);
    entries.forEach((r,i)=>r.posicao=i+1);
  }
  return rows;
}
async function apiGet(url,key,params) {
  if(!key) throw fault('API_ESPORTIVA_NAO_CONFIGURADA');
  let response;
  try { response=await axios.get(url,{params,headers:{'x-apisports-key':key,Accept:'application/json'},timeout:16000}); }
  catch(err){throw fault('API_INDISPONIVEL_'+String(err?.response?.status||err?.code||''));}
  const data=response.data;
  if(data?.errors && Object.keys(data.errors).length) throw fault('ERRO_API_'+JSON.stringify(data.errors).slice(0,150));
  if(!Array.isArray(data?.response)) throw fault('RESPOSTA_API_INVALIDA');
  return data.response;
}
function stateKey(config) {return config.esporte+':'+config.season;}
async function query(config){
  const sport=config.esporte;
  const season=String(config.season);
  const key = sport==='nba' ? process.env.API_NBA_KEY : process.env.API_NFL_KEY;
  const base=sport==='nba'?'https://v2.nba.api-sports.io':'https://v1.american-football.api-sports.io';
  const [standings,games]=await Promise.all([
    apiGet(base+'/standings',key,{league:config.league,season}),
    apiGet(base+'/games',key,{live:'all'}),
  ]);
  const recs=normalizedRows(standings,sport,season,config.league);
  const groups=sport==='nba'?['west','east']:['afc','nfc'];
  const allConfigs=Object.values(markets).filter(x=>x.esporte===sport&&String(x.season)===season);
  const allClubs=await Club.find({'metadata.ligaId':{$in:allConfigs.map(c=>c.id)}}).lean();
  if(allConfigs.length!==2) throw fault('DUPLAS_DE_CONFERENCIA_INCOMPLETAS');
  const changes=[];
  for(const cf of groups){
    const target=allConfigs.find(x=>x.conference===cf);
    if(!target)throw fault('CONFERENCIA_NAO_CONFIGURADA_'+cf);
    const db=allClubs.filter(x=>x.metadata?.ligaId===target.id);
    const source=recs.filter(x=>x.cf===cf);
    if(db.length!==target.participantes || source.length!==target.participantes) throw fault('CONFERENCIA_INCOMPLETA_'+cf+':'+db.length+'/'+source.length);
    const ids=new Map(db.map(c=>[n(c.metadata?.providerTeamId),c]));
    if(ids.size!==target.participantes || source.some(r=>!ids.has(r.id))) throw fault('IDS_API_NAO_CONFEREM_'+cf);
    if(db.some(c=>String(c.metadata?.temporada)!==season)) throw fault('TEMPORADA_DB_DESATUALIZADA_'+target.id);
    if(source.some(x=>!Number.isInteger(x.official)||x.official<1)) throw fault('RANKING_PROVEDOR_INVALIDO_'+cf);
  }
  const overlay=liveOverlay(recs,games,sport,season);
  rankRows(overlay.rows,overlay.live);
  const at=new Date();
  for(const rec of overlay.rows){
    const target=allConfigs.find(x=>x.conference===rec.cf);
    if(!target)continue;
    const club=allClubs.find(c=>c.metadata?.ligaId===target.id && n(c.metadata?.providerTeamId)===rec.id);
    if(!club) throw fault('CLUBE_NAO_CADASTRADO');
    if(!Number.isInteger(rec.posicao)||rec.posicao<1||rec.posicao>target.participantes) throw fault('POSICAO_INVALIDA');
    const freshPrice=calcularPrecoPorPosicao(rec.posicao,target.participantes);
    changes.push({updateOne:{filter:{_id:club._id,'metadata.temporada':target.season,'metadata.providerTeamId':rec.id},update:{$set:{
      posicao:rec.posicao,
      ...(getMarketMode()==='IPO'&&!club.ipoEncerrado?{precoAtual:freshPrice}:{}),
      'metadata.ultimaAtualizacaoEsportiva':at.toISOString(),
      'metadata.projecaoAoVivo':overlay.live,
      'metadata.classificacao.jogos':rec.win+rec.loss+rec.tie,
      'metadata.classificacao.vitorias':rec.win,
      'metadata.classificacao.derrotas':rec.loss,
      'metadata.classificacao.empates':rec.tie,
      'metadata.classificacao.percentualVitorias':(rec.win+rec.tie*0.5)/Math.max(1,rec.win+rec.loss+rec.tie),
    }}}});
  }
  if(changes.length!==allClubs.length) throw fault('CONTAGEM_DE_CLUBES_INCONSISTENTE');
  const session=await mongoose.startSession();
  try{await session.withTransaction(async()=>{
    const result=await Club.bulkWrite(changes,{ordered:true,session});
    if(result.matchedCount!==changes.length) throw fault('GRAVACAO_INCOMPLETA');
  });}finally{await session.endSession();}
  return {at:Date.now(),live:overlay.live,near:overlay.live,provisional:overlay.live,
    nextRefresh:overlay.live?TTL_LIVE:TTL_IDLE,clubs:changes.length};
}
async function refreshCompetition(config,{force=false}={}) {
  if(!config||!['nba','nfl'].includes(config.esporte)) throw fault('ESPORTE_NAO_SUPORTADO');
  const id=stateKey(config), past=cache.get(id);
  if(!force&&past&&Date.now()-past.at<past.nextRefresh)return past;
  if(flights.has(id))return flights.get(id);
  const job=query(config).then(s=>{cache.set(id,s);return s;}).finally(()=>flights.delete(id));
  flights.set(id,job);return job;
}
async function assertFreshForClub(club){
  const config=markets[club?.metadata?.ligaId];
  if(!config||!['nba','nfl'].includes(config.esporte))throw fault('LIGA_DESCONHECIDA');
  const r=await refreshCompetition(config);
  if(Date.now()-r.at>(r.live?75000:120000))throw fault('DADOS_AO_VIVO_DESATUALIZADOS');
}
module.exports={refreshCompetition,assertFreshForClub,liveOverlay,rankRows,normalizedRows};

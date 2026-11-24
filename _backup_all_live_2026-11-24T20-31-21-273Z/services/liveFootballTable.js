'use strict';
// Atualização de classificação a partir de partidas da temporada, inclusive placares em andamento.
// Não utiliza um snapshot de /standings que pode estar defasado durante o jogo.
const axios = require('axios');
const mongoose = require('mongoose');
const Club = require('../models/Club');
const { calcularPrecoPorPosicao } = require('../utils/liquidationPrice');
const { getMarketMode } = require('../config/marketMode');

const flight = new Map();
const cache = new Map();
const LIVE_STATES = new Set(['1H', 'HT', '2H', 'LIVE', 'BT']);
const FINISHED_STATES = new Set(['FT', 'AET', 'PEN']);
const MAX_AGE_WHILE_LIVE_MS = 20_000;
const MAX_AGE_NEAR_MATCH_MS = 30_000;
const MAX_AGE_IDLE_MS = 10 * 60_000;
const FRESHNESS_LIMIT_MS = 75_000;

function enabled(marketId) {
  // Por segurança, começa pela Champions. Outras ligas precisam estar com a
  // temporada corrente correta em config/sportsMarkets.js e API validada.
  const env = process.env.LIVE_FOOTBALL_MARKETS || 'champions-league';
  return env.split(',').map(s => s.trim()).includes(String(marketId));
}

function error(message) { const e = new Error(message); e.liveData = true; return e; }
const norm = n => Number(n);

function leaguePhaseFixture(fixture, config) {
  if (config.id !== 'champions-league') return true;
  const round = String(fixture?.league?.round || '').toLowerCase();
  return /league\s*(phase|stage)|regular season|group stage/.test(round);
}

function buildTable(fixtures, clubs, config) {
  const total = Number(config.participantes);
  if (clubs.length !== total) throw error(`LIGA_INCOMPLETA: ${clubs.length}/${total} clubes`);
  const byId = new Map();
  for (const c of clubs) {
    const id = Number(c.metadata?.providerTeamId);
    if (!Number.isSafeInteger(id) || byId.has(id)) throw error('IDS_API_DUPLICADOS_OU_AUSENTES');
    byId.set(id, {apiId:id, legacyId:Number(c.legacyId), nome:c.nome, escudo:c.escudo,
      posicaoAnterior:Number(c.posicao || 999), pontos:0, jogos:0, vitorias:0, empates:0, derrotas:0,
      golsPro:0, golsContra:0, golsFora:0, vitoriasFora:0, saldo:0, adversarios:[]});
  }
  const candidates = fixtures.filter(f => leaguePhaseFixture(f, config));
  if (config.id === 'champions-league' && candidates.length < 144) {
    throw error(`PARTIDAS_UCL_INCOMPLETAS: ${candidates.length}/144 (fase de liga)`);
  }
  if (!candidates.length) throw error('SEM_PARTIDAS_DA_LIGA');
  const seenFixtures = new Set();
  let live = false; let nextKickoff = Infinity; let lastKickoff = 0; let matchCount = 0;
  const now = Date.now();
  for (const f of candidates) {
    const fid = String(f.fixture?.id || '');
    if (!fid || seenFixtures.has(fid)) throw error('PARTIDA_DUPLICADA_SEM_ID');
    seenFixtures.add(fid);
    const home = byId.get(Number(f.teams?.home?.id));
    const away = byId.get(Number(f.teams?.away?.id));
    if (!home || !away || home === away) throw error(`PARTIDA_COM_TIME_NAO_RECONHECIDO: ${fid}`);
    const kickoff = Date.parse(f.fixture?.date || '') || 0;
    if (kickoff > now && kickoff < nextKickoff) nextKickoff = kickoff;
    if (kickoff && kickoff <= now) lastKickoff = Math.max(lastKickoff,kickoff);
    const status = String(f.fixture?.status?.short || '');
    if (LIVE_STATES.has(status)) live = true;
    if (!LIVE_STATES.has(status) && !FINISHED_STATES.has(status)) continue;
    const gh = Number(f.goals?.home), ga = Number(f.goals?.away);
    if (f.goals?.home == null || f.goals?.away == null || !Number.isInteger(gh) || !Number.isInteger(ga) || gh < 0 || ga < 0) {
      if (LIVE_STATES.has(status)) throw error(`PLACAR_AO_VIVO_INDISPONIVEL: ${fid}`);
      continue;
    }
    matchCount++;
    home.jogos++; away.jogos++;
    home.golsPro+=gh;home.golsContra+=ga;away.golsPro+=ga;away.golsContra+=gh;
    away.golsFora+=ga; home.adversarios.push(away.apiId); away.adversarios.push(home.apiId);
    if(gh>ga) {home.vitorias++;home.pontos+=3;away.derrotas++;}
    else if(ga>gh) {away.vitorias++;away.vitoriasFora++;away.pontos+=3;home.derrotas++;}
    else {home.empates++;away.empates++;home.pontos++;away.pontos++;}
  }
  if (!matchCount && candidates.some(f => FINISHED_STATES.has(String(f.fixture?.status?.short || '')))) throw error('RESULTADOS_INCOMPLETOS');
  const table=[...byId.values()];
  table.forEach(t=>{t.saldo=t.golsPro-t.golsContra;});
  for(const t of table) {
    t.adversariosPontos=t.adversarios.reduce((a,id)=>a+byId.get(id).pontos,0);
    t.adversariosSaldo=t.adversarios.reduce((a,id)=>a+byId.get(id).saldo,0);
    t.adversariosGols=t.adversarios.reduce((a,id)=>a+byId.get(id).golsPro,0);
  }
  // Critérios UEFA da fase de liga até adversários coletivos. Critérios finais
  // (disciplina / coeficiente) dependem de dados adicionais; preserva ordem anterior.
  table.sort((a,b)=>
    b.pontos-a.pontos || b.saldo-a.saldo || b.golsPro-a.golsPro ||
    (config.id==='champions-league' ? b.golsFora-a.golsFora || b.vitorias-a.vitorias || b.vitoriasFora-a.vitoriasFora ||
      b.adversariosPontos-a.adversariosPontos || b.adversariosSaldo-a.adversariosSaldo || b.adversariosGols-a.adversariosGols : b.vitorias-a.vitorias) ||
    a.posicaoAnterior-b.posicaoAnterior || a.apiId-b.apiId);
  table.forEach((t,i)=>{t.posicao=i+1;});
  const near = (nextKickoff-now<=45*60_000)||(now-lastKickoff<=4*60*60_000);
  return {table,live,near,matchCount,fixturesCount:candidates.length};
}

async function queryLeague(config) {
  const key=String(process.env.API_FOOTBALL_KEY||'');
  if (!key) throw error('API_FOOTBALL_KEY_NAO_CONFIGURADA');
  const clubs=await Club.find({'metadata.ligaId':config.id}).lean();
  const {data}=await axios.get('https://v3.football.api-sports.io/fixtures',{
    params:{league:config.league,season:config.season},
    headers:{'x-apisports-key':key,Accept:'application/json'},timeout:15000,
  });
  if(data?.errors && Object.keys(data.errors).length) throw error('API_FOOTBALL_ERRO: '+JSON.stringify(data.errors));
  if(!Array.isArray(data?.response)) throw error('API_FOOTBALL_SEM_FIXTURES');
  const r=buildTable(data.response,clubs,config);
  const now=new Date();
  const ops=r.table.map(t=>{
    const old=clubs.find(c=>Number(c.legacyId)===t.legacyId);
    const ipo=getMarketMode()==='IPO'&&!old?.ipoEncerrado;
    return {updateOne:{filter:{_id:old._id,'metadata.providerTeamId':t.apiId},update:{$set:{
      posicao:t.posicao,
      ...(ipo?{precoAtual:calcularPrecoPorPosicao(t.posicao,config.participantes)}:{}),
      'metadata.ultimaAtualizacaoEsportiva':now.toISOString(),
      'metadata.liveFixtureSync':{at:now,live:r.live,matchCount:r.matchCount},
      'metadata.classificacao.pontos':t.pontos,
      'metadata.classificacao.jogos':t.jogos,
      'metadata.classificacao.vitorias':t.vitorias,
      'metadata.classificacao.empates':t.empates,
      'metadata.classificacao.derrotas':t.derrotas,
      'metadata.classificacao.saldo':t.saldo,
      'metadata.classificacao.golsPro':t.golsPro,
      'metadata.classificacao.golsContra':t.golsContra,
    }}}};
  });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const result=await Club.bulkWrite(ops,{ordered:true,session});
      if(result.matchedCount!==clubs.length) throw error('ATUALIZACAO_CLUBES_INCOMPLETA');
    });
  } finally { await session.endSession(); }
  return {...r,at:Date.now(),nextRefresh:r.live?MAX_AGE_WHILE_LIVE_MS:r.near?MAX_AGE_NEAR_MATCH_MS:MAX_AGE_IDLE_MS};
}
async function refreshCompetition(config,{force=false}={}) {
  if(!config || config.esporte!=='football'||!enabled(config.id)) return null;
  const id=config.id;
  const previous=cache.get(id);
  if(!force&&previous&&Date.now()-previous.at<previous.nextRefresh) return previous;
  if(flight.has(id)) return flight.get(id);
  const job=queryLeague(config).then(result=>{cache.set(id,result);return result;}).finally(()=>flight.delete(id));
  flight.set(id,job);
  return job;
}
async function assertFreshForClub(club) {
  if(!enabled(club?.metadata?.ligaId)) return;
  const config=require('../config/sportsMarkets')[club.metadata.ligaId];
  if(!config) throw error('LIGA_DESCONHECIDA');
  const state=await refreshCompetition(config);
  const allowedAge = state?.live || state?.near ? FRESHNESS_LIMIT_MS : MAX_AGE_IDLE_MS + 15_000;
  if(!state||Date.now()-state.at>allowedAge) throw error('CLASSIFICACAO_DESATUALIZADA');
}
module.exports={enabled,buildTable,refreshCompetition,assertFreshForClub};

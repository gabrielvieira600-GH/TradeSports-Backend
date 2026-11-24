#!/usr/bin/env node
'use strict';
/**
 * Run in the backend root:
 *   node scripts/seedChampions2026.js --check
 *   node scripts/seedChampions2026.js --apply --confirm=CHAMPIONS_2026_27
 *
 * Does not reset holders, ledger, institutional state, or existing holdings.
 * Only saves after the 36 official teams, their distinct positions and their
 * official API-Football identities have been verified.
 */
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const Club = require('../models/Club');
const MarketControl = require('../models/MarketControl');
const { calcularPrecoPorPosicao } = require('../utils/liquidationPrice');
const ucl = require('../config/ucl2026');
const { parseApiFootballStandings } = require('../config/uclApiResponse');

function flag(name) { return process.argv.includes(name); }
const commit = flag('--apply');
if (commit && !flag('--confirm=CHAMPIONS_2026_27')) {
  console.error('Para gravar no MongoDB, inclua --apply --confirm=CHAMPIONS_2026_27');
  process.exit(2);
}
async function loadStandings() {
  const pathArg = process.argv.find(x => x.startsWith('--input='));
  if (pathArg) {
    const json = JSON.parse(fs.readFileSync(pathArg.slice(8), 'utf8'));
    if (Array.isArray(json)) return json; // lista de 36 clubes, sempre revalidada por validateStandings
    return parseApiFootballStandings(json, ucl);
  }
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY não configurada. Informe chave da API ou --input=standings.json.');
  const response = await fetch('https://v3.football.api-sports.io/standings?league=2&season=2026', {
    headers: { 'x-apisports-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`API-Football HTTP ${response.status}: verifique chave e plano da API.`);
  const json = await response.json();
  return parseApiFootballStandings(json, ucl);
}
async function verificarSabahFA(items) {
  const suspeitos = (Array.isArray(items) ? items : []).filter(x => ucl.normalize(x?.nome || x?.team?.name) === 'sabahfa');
  if (!suspeitos.length) return;
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('Sabah FA é um nome ambíguo. Informe API_FOOTBALL_KEY para verificar o país do clube.');
  for (const item of suspeitos) {
    const id = Number(item?.apiId ?? item?.team?.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Sabah FA: ID inválido da API.');
    const response = await fetch('https://v3.football.api-sports.io/teams?id=' + id, {
      headers: {'x-apisports-key': key, Accept:'application/json'}, signal:AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Sabah FA: falha na verificação do país, HTTP ' + response.status);
    const body = await response.json();
    const apiErrors = body?.errors && typeof body.errors === 'object' ? Object.values(body.errors).filter(Boolean) : [];
    if (apiErrors.length) throw new Error('Sabah FA: API recusou verificação de identidade: ' + apiErrors.join('; '));
    const detalhe = body?.response?.[0]?.team;
    const country = String(detalhe?.country || '');
    const normalizedCountry = ucl.normalize(country);
    console.log('[UCL] Conferência de identidade Sabah FA: ID=' + id + ', país=' + (country || '(ausente)'));
    if (!['azerbaijan','azerbaijao','azerbaycan'].includes(normalizedCountry)) {
      throw new Error('BLOQUEADO: Sabah FA retornou país ' + (country || '(não informado)') + ', mas a Champions exige o Sabah do Azerbaijão. Não registrar ID possivelmente pertencente ao clube da Malásia.');
    }
  }
}
async function main() {
  const rawStandings = await loadStandings();
  await verificarSabahFA(rawStandings);
  const standings = ucl.validateStandings(rawStandings);
  console.log(`[UCL] Lista oficial validada: ${standings.length} clubes / 36 posições / temporada 2026`);
  await connectDB();
  const existing = await Club.find({ 'metadata.ligaId': ucl.LEAGUE_ID });
  const byLegacy = new Map(existing.map(x => [Number(x.legacyId),x]));
  const byApi = new Map(existing.filter(x => x.metadata?.providerTeamId != null)
    .map(x => [Number(x.metadata.providerTeamId),x]));
  for (const team of standings) {
    const legacyId = ucl.toLegacyId(team);
    const existingClub = byLegacy.get(legacyId);
    const other = byApi.get(team.apiId);
    if (other && Number(other.legacyId) !== legacyId) throw new Error(`Conflito de identidade: ${team.nome}. Interrompido.`);
    const any = await Club.findOne({ legacyId });
    if (any && any.metadata?.ligaId !== ucl.LEAGUE_ID) throw new Error(`LegacyId ${legacyId} já pertence a outra liga.`);
    const price = calcularPrecoPorPosicao(team.posicao,36);
    console.log(`${String(team.posicao).padStart(2)}. ${team.nome.padEnd(22)} ID ${legacyId} API ${team.apiId} T$ ${price.toFixed(2)} ${existingClub ? 'atualizar posição' : 'cadastrar'}`);
  }
  if (!commit) { console.log('[UCL] CHECK concluído. Nenhum documento alterado.'); return; }
  const now=new Date();
  for (const team of standings) {
    const legacyId = ucl.toLegacyId(team);
    const current = byLegacy.get(legacyId);
    const price=calcularPrecoPorPosicao(team.posicao,36);
    const update = {
      nome: current?.nome || team.nome, nomeApi: team.nome,
      escudo: team.escudo || current?.escudo || '', posicao: team.posicao,
      'metadata.ligaId': ucl.LEAGUE_ID, 'metadata.ligaNome': 'UEFA Champions League — Fase de Liga',
      'metadata.esporte':'football','metadata.providerTeamId':team.apiId,
      'metadata.totalParticipantes':36,'metadata.temporada':2026,
      'metadata.ultimaAtualizacaoEsportiva':now.toISOString(),
      'metadata.classificacao': {pontos:team.pontos,jogos:team.jogos,vitorias:team.vitorias,
        empates:team.empates,derrotas:team.derrotas,saldo:team.saldo},
    };
    if (!current) {
      Object.assign(update,{legacyId,preco:price,precoAtual:price,cotasDisponiveis:1000,cotasEmitidas:0,ipoEncerrado:false});
    } else if (!current.ipoEncerrado && process.env.MARKET_MODE === 'IPO') {
      update.precoAtual=price;
    }
    await Club.findOneAndUpdate({legacyId},{$set:update},{upsert:true,setDefaultsOnInsert:true});
  }
  // A newly created league is closed until admin explicitly opens it.
  await MarketControl.findOneAndUpdate({ligaId:ucl.LEAGUE_ID},
    {$setOnInsert:{ligaId:ucl.LEAGUE_ID,fechado:true}},{upsert:true,new:true});
  const count=await Club.countDocuments({'metadata.ligaId':ucl.LEAGUE_ID});
  if(count!==36) throw new Error(`Gravação incompleta: ${count} clubes. Mantenha liga FECHADA e reconcilie.`);
  console.log('[UCL] 36 clubes cadastrados/atualizados. Liga criada FECHADA por segurança.');
  console.log('[UCL] Confira /api/tabelas/champions-league e use o painel admin para abrir o mercado.');
}
main().catch(e=>{console.error('[UCL] FALHA:',e.message);process.exitCode=1;})
  .finally(async()=>{await mongoose.disconnect().catch(()=>{});});

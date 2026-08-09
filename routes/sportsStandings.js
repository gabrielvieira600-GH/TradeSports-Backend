const express = require('express');
const axios = require('axios');
const Club = require('../models/Club');
const mercados = require('../config/sportsMarkets');
const { calcularPrecoPorPosicao } = require('../utils/liquidationPrice');

const router = express.Router();

function texto(v) { return String(v || '').trim(); }
function normalizar(v) { return texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function numero(...valores) {
  for (const valor of valores) {
    const n = Number(valor);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
function confereConferencia(valor, esperada) {
  const atual = normalizar(valor);
  if (esperada === 'west') return atual.includes('west');
  if (esperada === 'east') return atual.includes('east');
  if (esperada === 'afc') return atual.includes('afc') || atual.includes('american');
  if (esperada === 'nfc') return atual.includes('nfc') || atual.includes('national');
  return true;
}

async function buscarFootball(config) {
  const { data } = await axios.get('https://v3.football.api-sports.io/standings', {
    params: { league: config.league, season: config.season },
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY, Accept: 'application/json' },
    timeout: 15000,
  });
  const lista = data?.response?.[0]?.league?.standings?.[0];
  if (!Array.isArray(lista)) throw new Error('A fonte esportiva não retornou uma classificação válida.');
  return lista.map((item) => ({
    apiId: numero(item?.team?.id), nome: texto(item?.team?.name), escudo: texto(item?.team?.logo),
    posicao: numero(item?.rank), pontos: numero(item?.points), jogos: numero(item?.all?.played),
    vitorias: numero(item?.all?.win), empates: numero(item?.all?.draw), derrotas: numero(item?.all?.lose),
    saldo: numero(item?.goalsDiff), grupo: texto(item?.group),
  }));
}

async function buscarNBA(config) {
  const chave = process.env.API_NBA_KEY || process.env.API_FOOTBALL_KEY;
  if (!chave) throw new Error('API_NBA_KEY não configurada.');
  const { data } = await axios.get('https://v2.nba.api-sports.io/standings', {
    params: { league: config.league, season: config.season },
    headers: { 'x-apisports-key': chave, Accept: 'application/json' }, timeout: 15000,
  });
  const lista = Array.isArray(data?.response) ? data.response : [];
  return lista.filter((item) => confereConferencia(item?.conference?.name, config.conference)).map((item) => ({
    apiId: numero(item?.team?.id), nome: texto(item?.team?.name), escudo: texto(item?.team?.logo),
    posicao: numero(item?.conference?.rank, item?.position), pontos: numero(item?.win?.percentage) * 100,
    jogos: numero(item?.win?.total) + numero(item?.loss?.total), vitorias: numero(item?.win?.total),
    derrotas: numero(item?.loss?.total), empates: 0, saldo: numero(item?.win?.total) - numero(item?.loss?.total),
    grupo: texto(item?.division?.name || item?.conference?.name),
  }));
}

async function buscarNFL(config) {
  const chave = process.env.API_NFL_KEY || process.env.API_FOOTBALL_KEY;
  if (!chave) throw new Error('API_NFL_KEY não configurada.');
  const { data } = await axios.get('https://v1.american-football.api-sports.io/standings', {
    params: { league: config.league, season: config.season },
    headers: { 'x-apisports-key': chave, Accept: 'application/json' }, timeout: 15000,
  });
  const lista = Array.isArray(data?.response) ? data.response.flat(Infinity) : [];
  return lista.filter((item) => confereConferencia(item?.conference?.name || item?.conference, config.conference)).map((item) => ({
    apiId: numero(item?.team?.id), nome: texto(item?.team?.name), escudo: texto(item?.team?.logo),
    posicao: numero(item?.conference?.rank, item?.position, item?.rank), pontos: numero(item?.points?.for),
    jogos: numero(item?.won, item?.win?.total) + numero(item?.lost, item?.loss?.total) + numero(item?.ties),
    vitorias: numero(item?.won, item?.win?.total), derrotas: numero(item?.lost, item?.loss?.total),
    empates: numero(item?.ties), saldo: numero(item?.points?.for) - numero(item?.points?.against),
    grupo: texto(item?.division?.name || item?.division || item?.conference?.name || item?.conference),
  }));
}

async function sincronizar(config, classificacao) {
  const existentes = await Club.find({ 'metadata.ligaId': config.id });
  const porApiId = new Map(existentes.map((c) => [Number(c.metadata?.providerTeamId), c]));
  const resultado = [];
  for (const item of classificacao.filter((x) => x.apiId && x.nome && x.posicao)) {
    let clube = porApiId.get(item.apiId);
    const legacyId = config.namespace + item.apiId;
    if (!clube) clube = await Club.findOne({ legacyId });
    const precoInicial = calcularPrecoPorPosicao(item.posicao, config.participantes);
    const update = {
      legacyId, nome: clube?.nome || item.nome, nomeApi: item.nome, escudo: item.escudo || clube?.escudo || '',
      posicao: item.posicao, preco: clube?.preco ?? precoInicial, precoAtual: clube?.precoAtual ?? precoInicial,
      cotasDisponiveis: clube?.cotasDisponiveis ?? 1000, cotasEmitidas: clube?.cotasEmitidas ?? 0,
      ipoEncerrado: clube?.ipoEncerrado ?? false, splitFactorCumulativo: clube?.splitFactorCumulativo || 1,
      travadoAte: clube?.travadoAte || 0,
      metadata: { ...(clube?.metadata || {}), ligaId: config.id, ligaNome: config.nome, esporte: config.esporte,
        providerTeamId: item.apiId, temporada: config.season, totalParticipantes: config.participantes,
        ultimaAtualizacaoEsportiva: new Date().toISOString() },
    };
    clube = await Club.findOneAndUpdate({ legacyId }, { $set: update }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    resultado.push({
      id: clube.legacyId, legacyId: clube.legacyId, nome: clube.nome, escudo: clube.escudo,
      posicao: item.posicao, pontos: item.pontos, jogos: item.jogos, vitorias: item.vitorias,
      empates: item.empates, derrotas: item.derrotas, saldo: item.saldo, grupo: item.grupo,
      preco: Number(clube.preco || 0), precoAtual: clube.precoAtual == null ? Number(clube.preco || 0) : Number(clube.precoAtual),
      cotasDisponiveis: Number(clube.cotasDisponiveis || 0), cotasEmitidas: Number(clube.cotasEmitidas || 0),
      ipoEncerrado: Boolean(clube.ipoEncerrado),
    });
  }
  return resultado.sort((a, b) => a.posicao - b.posicao || a.nome.localeCompare(b.nome));
}

router.get('/tabelas/:mercadoId', async (req, res) => {
  const configBase = mercados[req.params.mercadoId];
  if (!configBase) return res.status(404).json({ erro: 'Mercado esportivo não encontrado.' });
  let config = { ...configBase };
  try {
    let classificacao = config.esporte === 'football' ? await buscarFootball(config)
      : config.esporte === 'nba' ? await buscarNBA(config) : await buscarNFL(config);
    const temporadaNumerica = Number(config.season);
    if (!classificacao.length && Number.isInteger(temporadaNumerica)) {
      config = { ...config, season: config.esporte === 'nba' ? String(temporadaNumerica - 1) : temporadaNumerica - 1 };
      classificacao = config.esporte === 'football' ? await buscarFootball(config)
        : config.esporte === 'nba' ? await buscarNBA(config) : await buscarNFL(config);
    }
    if (!classificacao.length) throw new Error('A classificação da temporada ainda não está disponível.');
    const data = await sincronizar(config, classificacao);
    return res.json({ data, mercado: config.id, nome: config.nome, temporada: config.season,
      participantes: config.participantes, atualizadoEm: new Date().toISOString() });
  } catch (erro) {
    console.error(`[TABELAS:${configBase.id}]`, erro?.response?.data || erro);
    return res.status(502).json({ erro: `Não foi possível carregar a tabela de ${config.nome}.` });
  }
});

module.exports = router;

const express = require('express');
const axios = require('axios');
const Club = require('../models/Club');
const mercados = require('../config/sportsMarkets');
const { calcularPrecoPorPosicao } = require('../utils/liquidationPrice');
const { loadCachedTable } = require('../services/sportsTableCache');
const MarketControl = require('../models/MarketControl');

const router = express.Router();

router.get('/market-status', async (_req, res) => {
  try {
    const controls = await MarketControl.find({ fechado: true }).select('ligaId fechado').lean();
    return res.json({ ok: true, mercados: controls });
  } catch (erro) {
    console.error('[MARKET STATUS] erro:', erro?.message);
    return res.status(500).json({ erro: 'Não foi possível consultar o estado dos mercados.' });
  }
});

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

const equipesReserva = {
  'nba-oeste': [
    ['Denver Nuggets', 'den'], ['Minnesota Timberwolves', 'min'], ['Oklahoma City Thunder', 'okc'],
    ['Portland Trail Blazers', 'por'], ['Utah Jazz', 'uta'], ['Golden State Warriors', 'gs'],
    ['LA Clippers', 'lac'], ['Los Angeles Lakers', 'lal'], ['Phoenix Suns', 'phx'], ['Sacramento Kings', 'sac'],
    ['Dallas Mavericks', 'dal'], ['Houston Rockets', 'hou'], ['Memphis Grizzlies', 'mem'], ['New Orleans Pelicans', 'no'], ['San Antonio Spurs', 'sa'],
  ],
  'nba-leste': [
    ['Boston Celtics', 'bos'], ['Brooklyn Nets', 'bkn'], ['New York Knicks', 'ny'],
    ['Philadelphia 76ers', 'phi'], ['Toronto Raptors', 'tor'], ['Chicago Bulls', 'chi'],
    ['Cleveland Cavaliers', 'cle'], ['Detroit Pistons', 'det'], ['Indiana Pacers', 'ind'], ['Milwaukee Bucks', 'mil'],
    ['Atlanta Hawks', 'atl'], ['Charlotte Hornets', 'cha'], ['Miami Heat', 'mia'], ['Orlando Magic', 'orl'], ['Washington Wizards', 'wsh'],
  ],
  'nfl-afc': [
    ['Buffalo Bills', 'buf', 'East'], ['Miami Dolphins', 'mia', 'East'], ['New England Patriots', 'ne', 'East'], ['New York Jets', 'nyj', 'East'],
    ['Baltimore Ravens', 'bal', 'North'], ['Cincinnati Bengals', 'cin', 'North'], ['Cleveland Browns', 'cle', 'North'], ['Pittsburgh Steelers', 'pit', 'North'],
    ['Houston Texans', 'hou', 'South'], ['Indianapolis Colts', 'ind', 'South'], ['Jacksonville Jaguars', 'jax', 'South'], ['Tennessee Titans', 'ten', 'South'],
    ['Denver Broncos', 'den', 'West'], ['Kansas City Chiefs', 'kc', 'West'], ['Las Vegas Raiders', 'lv', 'West'], ['Los Angeles Chargers', 'lac', 'West'],
  ],
  'nfl-nfc': [
    ['Dallas Cowboys', 'dal', 'East'], ['New York Giants', 'nyg', 'East'], ['Philadelphia Eagles', 'phi', 'East'], ['Washington Commanders', 'wsh', 'East'],
    ['Chicago Bears', 'chi', 'North'], ['Detroit Lions', 'det', 'North'], ['Green Bay Packers', 'gb', 'North'], ['Minnesota Vikings', 'min', 'North'],
    ['Atlanta Falcons', 'atl', 'South'], ['Carolina Panthers', 'car', 'South'], ['New Orleans Saints', 'no', 'South'], ['Tampa Bay Buccaneers', 'tb', 'South'],
    ['Arizona Cardinals', 'ari', 'West'], ['Los Angeles Rams', 'lar', 'West'], ['San Francisco 49ers', 'sf', 'West'], ['Seattle Seahawks', 'sea', 'West'],
  ],
};

function classificacaoReserva(config) {
  const equipes = equipesReserva[config.id];
  if (!equipes) return [];
  const sportPath = config.esporte === 'nba' ? 'nba' : 'nfl';
  return equipes.map(([nome, abreviacao, divisao], indice) => ({
    apiId: 900000 + indice + (config.esporte === 'nba' ? 0 : config.id === 'nfl-nfc' ? 100 : 50),
    nome,
    escudo: `https://a.espncdn.com/i/teamlogos/${sportPath}/500/${abreviacao}.png`,
    posicao: indice + 1,
    pontos: 0,
    jogos: 0,
    vitorias: 0,
    empates: 0,
    derrotas: 0,
    saldo: 0,
    grupo: divisao ? `${config.conference.toUpperCase()} ${divisao}` : config.conference,
  }));
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
        ultimaAtualizacaoEsportiva: new Date().toISOString(),
        classificacao: {
          pontos: item.pontos, jogos: item.jogos, vitorias: item.vitorias,
          empates: item.empates, derrotas: item.derrotas, saldo: item.saldo,
          grupo: item.grupo,
        } },
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
  let classificacao = [];
  let fonteReserva = false;
  try {
    classificacao = config.esporte === 'football' ? await buscarFootball(config)
      : config.esporte === 'nba' ? await buscarNBA(config) : await buscarNFL(config);
    const temporadaNumerica = Number(config.season);
    if (!classificacao.length && Number.isInteger(temporadaNumerica)) {
      config = { ...config, season: config.esporte === 'nba' ? String(temporadaNumerica - 1) : temporadaNumerica - 1 };
      classificacao = config.esporte === 'football' ? await buscarFootball(config)
        : config.esporte === 'nba' ? await buscarNBA(config) : await buscarNFL(config);
    }
  } catch (erro) {
    console.error(`[TABELAS:${configBase.id}]`, erro?.response?.data || erro?.message || erro);
  }

  if (!classificacao.length && configBase.esporte !== 'football') {
    classificacao = classificacaoReserva(configBase);
    fonteReserva = classificacao.length > 0;
  }

  if (classificacao.length) {
    try {
      const data = await sincronizar(configBase, classificacao);
      return res.json({ data, mercado: configBase.id, nome: configBase.nome, temporada: configBase.season,
        participantes: configBase.participantes, atualizadoEm: new Date().toISOString(),
        ...(fonteReserva ? { fonte: 'reserva', contingencia: true } : {}) });
    } catch (erro) {
      console.error(`[TABELAS:${configBase.id}:SYNC]`, erro);
    }
  }

  try {
    const data = await loadCachedTable(Club, configBase.id);
    if (data.length) {
      return res.json({ data, mercado: configBase.id, nome: configBase.nome,
        temporada: configBase.season, participantes: configBase.participantes,
        atualizadoEm: new Date().toISOString(), fonte: 'mongodb', contingencia: true });
    }
  } catch (cacheError) {
    console.error(`[TABELAS:${configBase.id}:CACHE]`, cacheError);
  }

  return res.status(503).json({ erro: `Não foi possível carregar a tabela de ${configBase.nome} e ainda não existe uma cópia salva.` });
});

module.exports = router;

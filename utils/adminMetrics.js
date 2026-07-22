const Order = require('../models/Order');
const User = require('../models/User');
const Dividendo = require('../models/dividendos');
const RankingRound = require('../models/RankingRound');
const FinancialTransaction = require('../models/FinancialTransaction');
const AdminMetricSnapshot = require('../models/AdminMetricSnapshot');
const { LedgerEntry } = require('./ledger');

const SAO_PAULO_OFFSET = '-03:00';

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function mesAtual() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
}

function validarMes(mes) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || ''))) {
    throw Object.assign(new Error('Mês inválido. Use o formato AAAA-MM.'), {
      status: 400,
    });
  }
  return String(mes);
}

function limitesMes(mes) {
  validarMes(mes);
  const [ano, numeroMes] = mes.split('-').map(Number);
  const proximoAno = numeroMes === 12 ? ano + 1 : ano;
  const proximoMes = numeroMes === 12 ? 1 : numeroMes + 1;
  return {
    inicio: new Date(`${mes}-01T00:00:00${SAO_PAULO_OFFSET}`),
    fim: new Date(
      `${proximoAno}-${String(proximoMes).padStart(2, '0')}-01T00:00:00${SAO_PAULO_OFFSET}`
    ),
  };
}

function deslocarMes(mes, delta) {
  const [ano, numeroMes] = validarMes(mes).split('-').map(Number);
  const data = new Date(Date.UTC(ano, numeroMes - 1 + delta, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

function semanasDoMes(inicio, fim) {
  const semanas = [];
  let cursor = new Date(inicio);
  let numero = 1;
  while (cursor < fim) {
    const local = new Date(cursor.getTime() - 3 * 60 * 60 * 1000);
    const dia = local.getUTCDay();
    const diasAteSegundaSeguinte = dia === 0 ? 1 : 8 - dia;
    const proxima = new Date(
      Math.min(
        fim.getTime(),
        cursor.getTime() + diasAteSegundaSeguinte * 24 * 60 * 60 * 1000
      )
    );
    semanas.push({ numero, inicio: new Date(cursor), fim: proxima });
    cursor = proxima;
    numero += 1;
  }
  return semanas;
}

function somarTransacoes(lista, tipo) {
  return lista
    .filter((item) => String(item.tipo).toUpperCase() === tipo)
    .reduce((acc, item) => acc + Number(item.valorBruto || 0), 0);
}

async function calcularPeriodo(inicio, fim, { incluirDetalhes = true } = {}) {
  const filtroCriacao = { criadoEm: { $gte: inicio, $lt: fim } };
  const [
    ordens,
    ordensExecutadas,
    ordensCanceladas,
    negocios,
    dividendos,
    transacoes,
    novosUsuarios,
    emailsVerificados,
    rodadas,
  ] = await Promise.all([
    Order.find(filtroCriacao)
      .select('usuarioId clubeId clubeLegacyId status criadoEm')
      .lean(),
    Order.countDocuments({ executadoEm: { $gte: inicio, $lt: fim } }),
    Order.countDocuments({ canceladoEm: { $gte: inicio, $lt: fim } }),
    LedgerEntry.find({ action: 'TRADE_EXEC', at: { $gte: inicio, $lt: fim } })
      .select('at meta')
      .lean(),
    Dividendo.find({ data: { $gte: inicio, $lt: fim } })
      .select('usuarioId totalPago data')
      .lean(),
    FinancialTransaction.find({
      status: 'CONFIRMADO',
      createdAt: { $gte: inicio, $lt: fim },
    })
      .select('tipo valorBruto taxa usuarioId createdAt')
      .lean(),
    User.countDocuments({ createdAt: { $gte: inicio, $lt: fim } }),
    User.countDocuments({ emailVerificadoEm: { $gte: inicio, $lt: fim } }),
    RankingRound.find({
      abertaEm: { $lt: fim },
      $or: [{ encerradaEm: null }, { encerradaEm: { $gte: inicio } }],
      status: { $in: ['aberta', 'encerrada'] },
    })
      .select('_id numero nome abertaEm encerradaEm')
      .lean(),
  ]);

  const usuariosComOrdens = new Set(ordens.map((o) => String(o.usuarioId)));
  const usuariosEmNegocios = new Set();
  const clubes = new Map();
  let volumeNegociado = 0;
  let taxasMaker = 0;
  let taxasTaker = 0;

  for (const negocio of negocios) {
    const meta = negocio.meta || {};
    const bruto = Number(meta.total ?? Number(meta.qty || 0) * Number(meta.price || 0));
    volumeNegociado += bruto;
    if (meta.buyerId) usuariosEmNegocios.add(String(meta.buyerId));
    if (meta.sellerId) usuariosEmNegocios.add(String(meta.sellerId));

    const buyerFee = Number(meta.buyerFee || 0);
    const sellerFee = Number(meta.sellerFee || 0);
    if (meta.buyerRole === 'maker') taxasMaker += buyerFee;
    else taxasTaker += buyerFee;
    if (meta.sellerRole === 'maker') taxasMaker += sellerFee;
    else taxasTaker += sellerFee;

    const clubeId = String(meta.clubeId || 'nao-identificado');
    const atual = clubes.get(clubeId) || { clubeId, negocios: 0, volume: 0 };
    atual.negocios += 1;
    atual.volume += bruto;
    clubes.set(clubeId, atual);
  }

  const usuariosAtivos = new Set([...usuariosComOrdens, ...usuariosEmNegocios]);
  const totalDividendos = dividendos.reduce(
    (acc, item) => acc + Number(item.totalPago || 0),
    0
  );
  const beneficiariosDividendos = new Set(
    dividendos.map((item) => String(item.usuarioId))
  ).size;
  const taxasFinanceiras = transacoes.reduce(
    (acc, item) => acc + Number(item.taxa || 0),
    0
  );
  const taxasNegociacao = taxasMaker + taxasTaker;

  const ordensPorRodada = rodadas.map((rodada) => {
    const rodadaInicio = new Date(Math.max(inicio, rodada.abertaEm || inicio));
    const rodadaFim = new Date(Math.min(fim, rodada.encerradaEm || fim));
    const quantidade = ordens.filter(
      (ordem) => ordem.criadoEm >= rodadaInicio && ordem.criadoEm < rodadaFim
    ).length;
    return { rodadaId: String(rodada._id), numero: rodada.numero, quantidade };
  });
  const mediaOrdensPorRodada = ordensPorRodada.length
    ? ordensPorRodada.reduce((acc, item) => acc + item.quantidade, 0) /
      ordensPorRodada.length
    : 0;

  return {
    ordens: {
      criadas: ordens.length,
      executadas: ordensExecutadas,
      canceladas: ordensCanceladas,
      usuarios: usuariosComOrdens.size,
      mediaPorUsuario: round2(ordens.length / Math.max(usuariosComOrdens.size, 1)),
      mediaPorRodada: round2(mediaOrdensPorRodada),
      taxaCancelamento: round2((ordensCanceladas / Math.max(ordens.length, 1)) * 100),
    },
    mercado: {
      negocios: negocios.length,
      volume: round2(volumeNegociado),
      ticketMedio: round2(volumeNegociado / Math.max(negocios.length, 1)),
      usuariosAtivos: usuariosAtivos.size,
      topClubes: incluirDetalhes
        ? [...clubes.values()]
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 10)
            .map((item) => ({ ...item, volume: round2(item.volume) }))
        : [],
    },
    receita: {
      taxasNegociacao: round2(taxasNegociacao),
      taxasMaker: round2(taxasMaker),
      taxasTaker: round2(taxasTaker),
      taxasFinanceiras: round2(taxasFinanceiras),
      taxasTotais: round2(taxasNegociacao + taxasFinanceiras),
    },
    dividendos: {
      disparos: dividendos.length,
      valor: round2(totalDividendos),
      beneficiarios: beneficiariosDividendos,
    },
    crescimento: {
      novosUsuarios,
      emailsVerificados,
      usuariosAtivos: usuariosAtivos.size,
      depositos: round2(somarTransacoes(transacoes, 'DEPOSITO')),
      saques: round2(somarTransacoes(transacoes, 'SAQUE')),
    },
    rodadas: incluirDetalhes ? ordensPorRodada : [],
  };
}

async function calcularMes(mes) {
  const { inicio, fim } = limitesMes(mes);
  const [metricas, ...semanas] = await Promise.all([
    calcularPeriodo(inicio, fim),
    ...semanasDoMes(inicio, fim).map(async (semana) => ({
      ...semana,
      metricas: await calcularPeriodo(semana.inicio, semana.fim, {
        incluirDetalhes: false,
      }),
    })),
  ]);
  return { mes, inicio, fim, metricas, semanas };
}

async function obterOuAtualizarSnapshot(mes, { forcar = false } = {}) {
  const atual = mesAtual();
  const existente = await AdminMetricSnapshot.findOne({ mes }).lean();
  if (existente && existente.fechado && !forcar) return existente;

  const calculado = await calcularMes(mes);
  const fechado = mes < atual;
  return AdminMetricSnapshot.findOneAndUpdate(
    { mes },
    {
      $set: {
        ...calculado,
        fechado,
        calculadoEm: new Date(),
        fechadoEm: fechado ? existente?.fechadoEm || new Date() : null,
        versao: 1,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

module.exports = {
  mesAtual,
  validarMes,
  deslocarMes,
  obterOuAtualizarSnapshot,
};

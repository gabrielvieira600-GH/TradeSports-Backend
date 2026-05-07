// utils/operationalChecks.js
const mongoose = require('mongoose');

const User = require('../models/User');
const Club = require('../models/Club');
const Order = require('../models/Order');
const Investment = require('../models/Investment');

const ledger = require('./ledger');
const antifraude = require('./antifraude');

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function envBool(name, defaultValue = false) {
  const v = String(process.env[name] ?? defaultValue).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

async function getAntifraudeResumo() {
  try {
    const stateDoc = await antifraude.loadState();
    const state = stateDoc?.toObject ? stateDoc.toObject() : stateDoc || {};

    const frozenUsers = Object.entries(state.users || {})
      .filter(([, v]) => Number(v?.frozenUntil || 0) > Date.now())
      .length;

    const frozenClubes = Object.entries(state.clubes || {})
      .filter(([, v]) => Number(v?.frozenUntil || 0) > Date.now())
      .length;

    return { frozenUsers, frozenClubes };
  } catch (_) {
    return { frozenUsers: 0, frozenClubes: 0 };
  }
}

async function getFinanceiroResumo() {
  try {
    if (typeof ledger.readFinancialTx === 'function') {
      const txs = await ledger.readFinancialTx();
      const arr = Array.isArray(txs) ? txs : [];

      return {
        transacoesFinanceiras: arr.length,
        transacoesPendentes: arr.filter((t) =>
          ['PENDENTE', 'PROCESSANDO'].includes(String(t?.status || ''))
        ).length,
        financeiro: arr,
      };
    }

    if (ledger.FinancialTransaction) {
      const total = await ledger.FinancialTransaction.countDocuments();
      const pendentes = await ledger.FinancialTransaction.countDocuments({
        status: { $in: ['PENDENTE', 'PROCESSANDO'] },
      });

      return {
        transacoesFinanceiras: total,
        transacoesPendentes: pendentes,
        financeiro: [],
      };
    }

    return { transacoesFinanceiras: 0, transacoesPendentes: 0, financeiro: [] };
  } catch (_) {
    return { transacoesFinanceiras: 0, transacoesPendentes: 0, financeiro: [] };
  }
}

async function getLedgerResumo() {
  try {
    if (ledger.LedgerEntry) {
      const total = await ledger.LedgerEntry.countDocuments();
      return { lancamentosLedger: total };
    }

    if (typeof ledger.readJournal === 'function') {
      const journal = await ledger.readJournal();
      return { lancamentosLedger: Array.isArray(journal) ? journal.length : 0 };
    }

    return { lancamentosLedger: 0 };
  } catch (_) {
    return { lancamentosLedger: 0 };
  }
}

async function runSystemCheck() {
  const problemasCriticos = [];
  const problemasMedios = [];
  const avisos = [];

  if (!isMongoConnected()) {
    problemasCriticos.push({
      tipo: 'MONGO_DESCONECTADO',
      readyState: mongoose.connection.readyState,
    });
  }

  const [
    usuarios,
    ordens,
    clubes,
    investimentosCount,
    financeiroResumo,
    ledgerResumo,
    antifraudeResumo,
  ] = await Promise.all([
    User.find({}, { saldo: 1, carteira: 1, legacyId: 1, nomeUsuario: 1 }).lean(),
    Order.find({}, {
      usuarioId: 1,
      usuarioLegacyId: 1,
      clubeId: 1,
      clubeLegacyId: 1,
      tipo: 1,
      preco: 1,
      quantidade: 1,
      restante: 1,
      status: 1,
    }).lean(),
    Club.find({}, {
      legacyId: 1,
      nome: 1,
      preco: 1,
      precoAtual: 1,
      cotasDisponiveis: 1,
      cotasEmitidas: 1,
      ipoEncerrado: 1,
    }).lean(),
    Investment.countDocuments(),
    getFinanceiroResumo(),
    getLedgerResumo(),
    getAntifraudeResumo(),
  ]);

  const usuariosById = new Map(usuarios.map((u) => [String(u._id), u]));
  const clubesById = new Map(clubes.map((c) => [String(c._id), c]));
  const clubesByLegacy = new Map(clubes.map((c) => [String(c.legacyId), c]));

  for (const u of usuarios) {
    if (Number(u?.saldo || 0) < 0) {
      problemasCriticos.push({
        tipo: 'SALDO_NEGATIVO',
        usuarioId: String(u._id),
        usuarioLegacyId: u.legacyId ?? null,
        saldo: Number(u.saldo || 0),
      });
    }

    const carteira = Array.isArray(u?.carteira) ? u.carteira : [];

    for (const ativo of carteira) {
      if (Number(ativo?.quantidade || 0) < 0) {
        problemasCriticos.push({
          tipo: 'CARTEIRA_NEGATIVA',
          usuarioId: String(u._id),
          usuarioLegacyId: u.legacyId ?? null,
          clubeId: ativo?.clubeId,
          quantidade: Number(ativo?.quantidade || 0),
        });
      }

      if (Number(ativo?.totalInvestido || 0) < 0) {
        problemasCriticos.push({
          tipo: 'CARTEIRA_TOTAL_INVESTIDO_NEGATIVO',
          usuarioId: String(u._id),
          usuarioLegacyId: u.legacyId ?? null,
          clubeId: ativo?.clubeId,
          totalInvestido: Number(ativo?.totalInvestido || 0),
        });
      }

      if (!clubesByLegacy.has(String(ativo?.clubeId))) {
        problemasMedios.push({
          tipo: 'CARTEIRA_CLUBE_NAO_ENCONTRADO',
          usuarioId: String(u._id),
          clubeId: ativo?.clubeId,
        });
      }
    }
  }

  for (const o of ordens) {
    if (!o?._id) problemasMedios.push({ tipo: 'ORDEM_SEM_ID' });

    if (!o?.clubeId && !o?.clubeLegacyId) {
      problemasMedios.push({ tipo: 'ORDEM_SEM_CLUBE', ordemId: String(o?._id || '') });
    }

    if (!o?.usuarioId && !o?.usuarioLegacyId) {
      problemasMedios.push({ tipo: 'ORDEM_SEM_USUARIO', ordemId: String(o?._id || '') });
    }

    if (Number(o?.quantidade || 0) <= 0) {
      problemasCriticos.push({ tipo: 'ORDEM_QTD_INVALIDA', ordemId: String(o?._id || '') });
    }

    if (Number(o?.preco || 0) <= 0) {
      problemasCriticos.push({ tipo: 'ORDEM_PRECO_INVALIDO', ordemId: String(o?._id || '') });
    }

    if (Number(o?.restante || 0) < 0) {
      problemasCriticos.push({ tipo: 'ORDEM_RESTANTE_NEGATIVO', ordemId: String(o?._id || '') });
    }

    if (o?.usuarioId && !usuariosById.has(String(o.usuarioId))) {
      problemasCriticos.push({
        tipo: 'ORDEM_USUARIO_INEXISTENTE',
        ordemId: String(o._id),
        usuarioId: String(o.usuarioId),
      });
    }

    if (o?.clubeId && !clubesById.has(String(o.clubeId))) {
      problemasCriticos.push({
        tipo: 'ORDEM_CLUBE_INEXISTENTE',
        ordemId: String(o._id),
        clubeId: String(o.clubeId),
      });
    }

    if (String(o?.tipo) === 'venda' && ['aberta', 'parcial'].includes(String(o?.status))) {
      const user = usuariosById.get(String(o.usuarioId));
      const pos = (Array.isArray(user?.carteira) ? user.carteira : [])
        .find((a) => Number(a.clubeId) === Number(o.clubeLegacyId));

      const qtdDisponivel = Number(pos?.quantidade || 0);

      if (Number(o?.restante || 0) > qtdDisponivel) {
        problemasCriticos.push({
          tipo: 'VENDA_EXCEDE_POSICAO',
          ordemId: String(o._id),
          usuarioId: o.usuarioId ? String(o.usuarioId) : null,
          clubeId: o.clubeLegacyId ?? null,
          restante: Number(o.restante || 0),
          disponivel: qtdDisponivel,
        });
      }
    }

    if (String(o?.tipo) === 'compra' && ['aberta', 'parcial'].includes(String(o?.status))) {
      const user = usuariosById.get(String(o.usuarioId));
      const total = round2(Number(o?.restante || 0) * Number(o?.preco || 0));

      if (Number(user?.saldo || 0) + 0.0001 < total) {
        problemasMedios.push({
          tipo: 'COMPRA_ABERTA_ACIMA_SALDO_ATUAL',
          ordemId: String(o._id),
          usuarioId: o.usuarioId ? String(o.usuarioId) : null,
          custo: total,
          saldoAtual: Number(user?.saldo || 0),
        });
      }
    }
  }

  for (const c of clubes) {
    if (Number(c?.cotasDisponiveis || 0) < 0) {
      problemasCriticos.push({
        tipo: 'CLUBE_COTAS_DISPONIVEIS_NEGATIVAS',
        clubeId: c.legacyId,
        cotasDisponiveis: c.cotasDisponiveis,
      });
    }

    if (Number(c?.cotasEmitidas || 0) < 0) {
      problemasCriticos.push({
        tipo: 'CLUBE_COTAS_EMITIDAS_NEGATIVAS',
        clubeId: c.legacyId,
        cotasEmitidas: c.cotasEmitidas,
      });
    }

    if (Number(c?.precoAtual ?? c?.preco ?? 0) < 0) {
      problemasCriticos.push({
        tipo: 'CLUBE_PRECO_NEGATIVO',
        clubeId: c.legacyId,
        precoAtual: c.precoAtual,
        preco: c.preco,
      });
    }
  }

  if (financeiroResumo.transacoesPendentes > 50) {
    avisos.push({ tipo: 'MUITAS_TRANSACOES_PENDENTES' });
  }

  const ordensAbertas = ordens.filter((o) =>
    ['aberta', 'parcial'].includes(String(o?.status || '')) &&
    Number(o?.restante || 0) > 0
  ).length;

  const statusGeral =
    problemasCriticos.length > 0
      ? 'CRITICO'
      : problemasMedios.length > 0
        ? 'ATENCAO'
        : 'OK';

  return {
    statusGeral,
    resumo: {
      usuarios: usuarios.length,
      ordensAbertas,
      clubes: clubes.length,
      investimentos: investimentosCount,
      lancamentosLedger: ledgerResumo.lancamentosLedger,
      transacoesFinanceiras: financeiroResumo.transacoesFinanceiras,
      transacoesPendentes: financeiroResumo.transacoesPendentes,
      frozenUsers: antifraudeResumo.frozenUsers,
      frozenClubes: antifraudeResumo.frozenClubes,
    },
    problemasCriticos,
    problemasMedios,
    avisos,
    flags: {
      betaMode: envBool('BETA_MODE', true),
      depositsEnabled: envBool('ENABLE_DEPOSITS', true),
      withdrawalsEnabled: envBool('ENABLE_WITHDRAWALS', true),
      mongoConnected: isMongoConnected(),
    },
  };
}

async function buildHealthPayload() {
  const check = await runSystemCheck();

  return {
    ok: check.statusGeral !== 'CRITICO',
    status: check.statusGeral,
    ts: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    resumo: check.resumo,
    flags: check.flags,
    criticos: check.problemasCriticos.length,
    medios: check.problemasMedios.length,
    avisos: check.avisos.length,
  };
}

module.exports = {
  runSystemCheck,
  buildHealthPayload,
};
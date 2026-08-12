const mongoose = require('mongoose');
const User = require('../models/User');
const RankingSeason = require('../models/RankingSeason');
const RecoveryRecharge = require('../models/RecoveryRecharge');
const Investment = require('../models/Investment');
const audit = require('../utils/audit');
const ledger = require('../utils/ledger');
const { valueUserPortfolio } = require('../utils/portfolioValuation');
const {
  performanceForPatrimony,
  round2,
  stateAfterContribution,
} = require('../utils/rankingPerformance');

const TARGET_PATRIMONY = 1000;
const MIN_TS = 100;
const STEP_TS = 10;
const BRL_CENTS_PER_TS = 5;

function maxRechargeForPatrimony(patrimony) {
  const gap = Math.max(0, TARGET_PATRIMONY - Number(patrimony || 0));
  return Math.max(0, Math.floor((gap + 1e-9) / STEP_TS) * STEP_TS);
}

function brlCentsForTs(amountTs) {
  return Math.round(Number(amountTs || 0) * BRL_CENTS_PER_TS);
}

function validateAmount(amountTs, maxTs) {
  const amount = Number(amountTs);
  if (!Number.isInteger(amount) || amount < MIN_TS || amount % STEP_TS !== 0) {
    const error = new Error('Escolha uma quantidade entre T$ 100 e o limite disponível, em passos de T$ 10.');
    error.status = 400;
    error.code = 'QUANTIDADE_INVALIDA';
    throw error;
  }
  if (amount > maxTs) {
    const error = new Error(`Seu limite atual de recuperação é T$ ${maxTs}.`);
    error.status = 409;
    error.code = 'LIMITE_RECALCULADO';
    throw error;
  }
  return amount;
}

async function activeSeason(session = null) {
  const query = RankingSeason.findOne({ status: 'ativa' }).sort({ iniciadaEm: -1, createdAt: -1 });
  if (session) query.session(session);
  return query;
}

async function rechargeSummary(user, { session = null } = {}) {
  const [portfolio, season] = await Promise.all([
    valueUserPortfolio(user, { session, includeOrders: true }),
    activeSeason(session),
  ]);
  const maxTs = maxRechargeForPatrimony(portfolio.patrimonio);
  const performance = performanceForPatrimony(user, portfolio.patrimonio, season);
  return {
    alvoPatrimonio: TARGET_PATRIMONY,
    minimoTs: MIN_TS,
    passoTs: STEP_TS,
    centavosPorTs: BRL_CENTS_PER_TS,
    maximoTs: maxTs,
    elegivel: maxTs >= MIN_TS,
    ...portfolio,
    rentabilidade: performance.rentabilidade,
    resultado: performance.resultado,
    aportesExternosTotal: performance.aportesExternosTotal,
    temporada: season ? { id: String(season._id), codigo: season.codigo, nome: season.nome } : null,
  };
}

async function confirmRecharge(rechargeId, { paymentId = null } = {}) {
  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const recharge = await RecoveryRecharge.findOne({
        _id: rechargeId,
        status: { $in: ['PENDENTE', 'PROCESSANDO'] },
      }).session(session);
      if (!recharge) {
        const existing = await RecoveryRecharge.findById(rechargeId).session(session).lean();
        response = existing;
        return;
      }

      recharge.status = 'PROCESSANDO';
      await recharge.save({ session });

      const user = await User.findById(recharge.usuarioId).session(session);
      if (!user) throw new Error('Usuário da recarga não encontrado.');
      const season = await activeSeason(session);
      const portfolio = await valueUserPortfolio(user, { session, includeOrders: true });
      const maxTs = maxRechargeForPatrimony(portfolio.patrimonio);

      if (Number(recharge.quantidadeTs) > maxTs) {
        recharge.status = 'FALHA';
        recharge.motivoFalha = 'PATRIMONIO_ACIMA_DO_LIMITE_NA_CONFIRMACAO';
        recharge.patrimonioConfirmacao = portfolio.patrimonio;
        await recharge.save({ session });
        response = recharge.toObject();
        return;
      }

      const at = new Date();
      const performanceBefore = performanceForPatrimony(user, portfolio.patrimonio, season);
      user.rankingPerformance = stateAfterContribution({
        user,
        patrimonyBefore: portfolio.patrimonio,
        amount: recharge.quantidadeTs,
        season,
        at,
      });
      user.saldo = round2(Number(user.saldo || 0) + Number(recharge.quantidadeTs));
      await user.save({ session });

      recharge.status = 'CONFIRMADA';
      recharge.pagamentoId = paymentId || recharge.pagamentoId;
      recharge.patrimonioConfirmacao = portfolio.patrimonio;
      recharge.confirmadaEm = at;
      recharge.metadata = {
        ...(recharge.metadata || {}),
        rentabilidadePreservada: performanceBefore.rentabilidade,
      };
      await recharge.save({ session });

      await Investment.create([{
        legacyId: `recovery_${String(recharge._id)}`,
        usuarioId: user._id,
        usuarioLegacyId: user.legacyId ?? null,
        clubeId: null,
        clubeLegacyId: null,
        clubeNome: '',
        quantidade: 0,
        precoUnitario: round2(recharge.quantidadeTs),
        valorUnitario: round2(recharge.quantidadeTs),
        totalPago: round2(recharge.quantidadeTs),
        tipo: 'RECARGA_RECUPERACAO',
        origem: 'RECUPERACAO_PAGA',
        data: at,
        metadata: {
          recoveryRechargeId: String(recharge._id),
          valorReaisCentavos: recharge.valorReaisCentavos,
          pagamentoId: recharge.pagamentoId,
          naoSacavel: true,
        },
      }], { session });

      await ledger.postJournal({
        action: 'RECOVERY_RECHARGE_CONFIRMED',
        idemKey: `recovery-recharge:${String(recharge._id)}`,
        meta: {
          userId: String(user._id),
          quantidadeTs: recharge.quantidadeTs,
          valorReaisCentavos: recharge.valorReaisCentavos,
          paymentId: recharge.pagamentoId,
        },
        lines: [
          { account: `user:${String(user._id)}`, debit: recharge.quantidadeTs },
          { account: 'platform:recovery:issued', credit: recharge.quantidadeTs },
        ],
        session,
      });

      await audit.logEvent({
        kind: 'FINANCE',
        action: 'RECARGA_RECUPERACAO_CONFIRMADA',
        userId: String(user._id),
        entityType: 'RecoveryRecharge',
        entityId: String(recharge._id),
        meta: {
          quantidadeTs: recharge.quantidadeTs,
          valorReaisCentavos: recharge.valorReaisCentavos,
          patrimonioAntes: portfolio.patrimonio,
          rentabilidadePreservada: performanceBefore.rentabilidade,
        },
      }, session);

      response = { ...recharge.toObject(), saldo: user.saldo };
    });
    return response;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  BRL_CENTS_PER_TS,
  MIN_TS,
  STEP_TS,
  TARGET_PATRIMONY,
  activeSeason,
  brlCentsForTs,
  confirmRecharge,
  maxRechargeForPatrimony,
  rechargeSummary,
  validateAmount,
};

const User = require('../models/User');
const Club = require('../models/Club');
const Order = require('../models/Order');
const InstitutionalLiquidity = require('../models/InstitutionalLiquidity');
const InstitutionalDailyLimit = require('../models/InstitutionalDailyLimit');
const MarketLiquiditySettings = require('../models/MarketLiquiditySettings');
const bcrypt = require('bcryptjs');

const { TICK_SIZE, round2, tickUp, tickDown, tickNearest, pricesFor } = require('../utils/institutionalPricing');
const ACCOUNT_EMAIL = 'liquidez@system.tradesports';

async function getInstitutionalUser(session = null) {
  let user = await User.findOne({ 'metadata.accountType': 'INSTITUTIONAL' }).session(session);
  if (user) return user;

  const payload = {
    nome: 'TradeSports Liquidez',
    email: ACCOUNT_EMAIL,
    nomeUsuario: 'TradeSportsLiquidez',
    senha: await bcrypt.hash(`SYSTEM_ONLY_${Date.now()}_${Math.random().toString(36).slice(2)}`, 12),
    saldo: 0,
    carteira: [],
    metadata: {
      accountType: 'INSTITUTIONAL',
      publicProfile: false,
      rankingsEligible: false,
      dividendsEligible: false,
      liquidationEligible: false,
      feesExempt: true,
    },
    rankingAtivo: false,
    carteiraPublica: { visibilidade: 'privada', nivelDetalhe: 'resumo', mostrarValores: false },
  };
  const [created] = await User.create([payload], { session });
  return created;
}

async function ensureLiquidityState(club, session = null) {
  return InstitutionalLiquidity.findOneAndUpdate(
    { clubId: club._id },
    {
      $setOnInsert: {
        clubId: club._id,
        clubLegacyId: club.legacyId,
        maxShares: 1000,
        issuedShares: Number(club.cotasEmitidas || 0),
        basePositionValue: Number(club.precoAtual ?? club.preco ?? 0),
      },
    },
    { upsert: true, new: true, session }
  );
}

async function cancelInstitutionalOrders(clubId, session = null) {
  return Order.updateMany(
    { clubId, isInstitutional: true, status: { $in: ['aberta', 'parcial'] } },
    { $set: { status: 'cancelada', canceladoEm: new Date() } },
    { session }
  );
}

async function publishOrdersForClub(club, { round = null, session = null } = {}) {
  const institutional = await getInstitutionalUser(session);
  const state = await ensureLiquidityState(club, session);
  await cancelInstitutionalOrders(club._id, session);

  if (state.institutionalSuspended) return { state, orders: [] };

  const base = tickNearest(club.precoAtual ?? club.preco ?? 0);
  const { primaryAsk, resaleAsk, bid } = pricesFor(state, base);
  const orders = [];
  const unissued = Math.max(0, Number(state.maxShares) - Number(state.issuedShares));
  const resale = Math.max(0, Number(state.institutionHeldIssuedShares));
  const allStates = await InstitutionalLiquidity.find({}).select('issuedShares').session(session).lean();
  const averageIssued = allStates.length
    ? allStates.reduce((sum, item) => sum + Number(item.issuedShares || 0), 0) / allStates.length
    : 0;
  const concentrationLimit = Math.max(
    Number(state.visibleSellLot),
    averageIssued * (1 + Number(state.concentrationAboveAveragePct || 0))
  );
  const concentrationBlocked = Number(state.issuedShares) >= concentrationLimit && unissued > 0;
  const resaleQty = Math.min(Number(state.visibleSellLot), resale);
  const primaryQty = Math.min(
    Math.max(0, Number(state.visibleSellLot) - resaleQty),
    (state.issuanceSuspended || concentrationBlocked) ? 0 : unissued
  );

  // Cotas recompradas remuneram a liquidez bilateral e podem usar margem.
  if (resaleQty > 0 && resaleAsk > 0) {
    const [sell] = await Order.create([{
      legacyId: `inst_sell_${club.legacyId}_${Date.now()}`,
      usuarioId: institutional._id,
      usuarioLegacyId: institutional.legacyId ?? null,
      clubeId: club._id,
      clubeLegacyId: club.legacyId,
      tipo: 'venda', preco: resaleAsk, quantidade: resaleQty, restante: resaleQty,
      status: 'aberta', isInstitutional: true, institutionalPriority: 1,
      metadata: { isInstitutional: true, purpose: 'RESALE', round },
    }], { session });
    orders.push(sell);
  }

  // Cotas inéditas entram no mercado exatamente pelo valor oficial da posição.
  if (primaryQty > 0 && primaryAsk > 0) {
    const [sell] = await Order.create([{
      legacyId: `inst_issue_${club.legacyId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      usuarioId: institutional._id,
      usuarioLegacyId: institutional.legacyId ?? null,
      clubeId: club._id,
      clubeLegacyId: club.legacyId,
      tipo: 'venda', preco: primaryAsk, quantidade: primaryQty, restante: primaryQty,
      status: 'aberta', isInstitutional: true, institutionalPriority: 1,
      metadata: { isInstitutional: true, purpose: 'ISSUANCE', round },
    }], { session });
    orders.push(sell);
  }

  if (Number(state.issuedShares) > 0 && bid > 0) {
    const [buy] = await Order.create([{
      legacyId: `inst_buy_${club.legacyId}_${Date.now()}`,
      usuarioId: institutional._id,
      usuarioLegacyId: institutional.legacyId ?? null,
      clubeId: club._id,
      clubeLegacyId: club.legacyId,
      tipo: 'compra', preco: bid, quantidade: 50, restante: 50,
      status: 'aberta', isInstitutional: true, institutionalPriority: 1,
      metadata: { isInstitutional: true, purpose: 'LIMITED_BUYBACK', round },
    }], { session });
    orders.push(buy);
  }

  state.basePositionValue = base;
  state.institutionalAsk = primaryQty > 0 ? primaryAsk : (resaleQty > 0 ? resaleAsk : 0);
  state.institutionalBid = bid;
  state.lastRepricedAt = new Date();
  state.lastRepricedRound = round;
  await state.save({ session });
  return { state, orders };
}

function dateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
}

async function validateBuybackLimit({ state, clubId, userId, quantity, session }) {
  const key = dateKey();
  const userUsage = await InstitutionalDailyLimit.findOne({ dateKey: key, clubId, userId }).session(session);
  const clubUsage = await InstitutionalDailyLimit.aggregate([
      { $match: { dateKey: key, clubId } },
      { $group: { _id: null, quantity: { $sum: '$quantity' } } },
    ]).session(session);
  if (Number(userUsage?.quantity || 0) + quantity > Number(state.dailyBuybackPerUser)) {
    throw new Error('LIMITE_RECOMPRA_USUARIO');
  }
  if (Number(clubUsage?.[0]?.quantity || 0) + quantity > Number(state.dailyBuybackPerClub)) {
    throw new Error('LIMITE_RECOMPRA_CLUBE');
  }
}

async function recordBuyback({ clubId, userId, quantity, session }) {
  await InstitutionalDailyLimit.findOneAndUpdate(
    { dateKey: dateKey(), clubId, userId },
    { $inc: { quantity } },
    { upsert: true, new: true, session }
  );
}

async function exposureSnapshot() {
  const states = await InstitutionalLiquidity.find({}).lean();
  const settings = await MarketLiquiditySettings.findOneAndUpdate(
    { key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true, new: true }
  ).lean();
  const currentObligation = round2(states.reduce((sum, s) => sum + s.issuedShares * s.basePositionValue, 0));
  const fund = round2(states.reduce((sum, s) => sum + s.liquidationFund, 0) + Number(settings.operationalReserve || 0));
  const sortedIssued = states.map((s) => s.issuedShares).sort((a, b) => b - a);
  const positionValues = states.map((s) => s.basePositionValue).sort((a, b) => b - a);
  const adverseObligation = round2(sortedIssued.reduce((sum, qty, i) => sum + qty * Number(positionValues[i] || 0), 0));
  return {
    currentObligation, adverseObligation, liquidationFund: fund,
    coveragePct: adverseObligation > 0 ? round2(fund / adverseObligation) : null,
    minimumCoveragePct: states[0]?.minimumCoveragePct ?? 1.1,
    operationalReserve: Number(settings.operationalReserve || 0),
  };
}

async function enforceSolvency() {
  const exposure = await exposureSnapshot();
  if (exposure.coveragePct != null && exposure.coveragePct < exposure.minimumCoveragePct) {
    await InstitutionalLiquidity.updateMany(
      { issuedShares: { $lt: 1000 } },
      { $set: { issuanceSuspended: true, suspensionReason: 'Cobertura abaixo do mínimo operacional' } }
    );
    return { ...exposure, issuanceSuspended: true };
  }
  return { ...exposure, issuanceSuspended: false };
}

module.exports = {
  TICK_SIZE, getInstitutionalUser, ensureLiquidityState, pricesFor,
  cancelInstitutionalOrders, publishOrdersForClub, validateBuybackLimit,
  recordBuyback, exposureSnapshot,
  enforceSolvency,
};

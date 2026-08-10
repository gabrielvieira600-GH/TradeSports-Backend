const express = require('express');
const auth = require('../../middleware/auth');
const isAdmin = require('../../middleware/admin');
const audit = require('../../utils/audit');
const Club = require('../../models/Club');
const Order = require('../../models/Order');
const Investment = require('../../models/Investment');
const InstitutionalLiquidity = require('../../models/InstitutionalLiquidity');
const MarketLiquiditySettings = require('../../models/MarketLiquiditySettings');
const { getMarketMode } = require('../../config/marketMode');
const {
  getInstitutionalUser, ensureLiquidityState, publishOrdersForClub,
  cancelInstitutionalOrders, exposureSnapshot,
} = require('../../services/institutionalLiquidity');

const router = express.Router();
router.use(auth, isAdmin);

router.get('/', async (_req, res) => {
  const [account, states, exposure, settings, marketMetrics] = await Promise.all([
    getInstitutionalUser(),
    InstitutionalLiquidity.find({}).sort({ clubLegacyId: 1 }).lean(),
    exposureSnapshot(),
    MarketLiquiditySettings.findOneAndUpdate(
      { key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true, new: true }
    ).lean(),
    Investment.aggregate([
      { $match: { tipo: 'COMPRA' } },
      { $group: {
        _id: { $cond: [{ $eq: ['$metadata.institutionalCounterparty', true] }, 'USER_INSTITUTION', 'USER_USER'] },
        trades: { $sum: 1 }, quantity: { $sum: '$quantidade' }, gross: { $sum: { $multiply: ['$quantidade', '$precoUnitario'] } },
      } },
    ]),
  ]);
  return res.json({
    ok: true, marketMode: getMarketMode(), settings, exposure, states, marketMetrics,
    account: {
      id: account._id, nome: account.nome, saldo: account.saldo,
      carteira: account.carteira, publicProfile: false, rankingsEligible: false,
    },
  });
});

router.post('/inicializar', async (req, res) => {
  const clubs = await Club.find({}).sort({ legacyId: 1 });
  const round = req.body?.round == null ? null : Number(req.body.round);
  const results = [];
  for (const club of clubs) results.push(await publishOrdersForClub(club, { round }));
  await audit.logEvent({ kind: 'ADMIN', action: 'INSTITUTIONAL_LIQUIDITY_INITIALIZED', userId: req.usuario.id, meta: { clubs: clubs.length, round } });
  return res.json({ ok: true, clubs: results.length });
});

router.post('/reprecificar', async (req, res) => {
  const round = req.body?.round == null ? null : Number(req.body.round);
  const clubs = await Club.find({}).sort({ legacyId: 1 });
  for (const club of clubs) await publishOrdersForClub(club, { round });
  await MarketLiquiditySettings.findOneAndUpdate(
    { key: 'default' },
    { $set: { lastGlobalRepriceAt: new Date(), lastGlobalRepriceRound: round, suspendedDuringMatches: false } },
    { upsert: true }
  );
  await audit.logEvent({ kind: 'ADMIN', action: 'INSTITUTIONAL_ORDERS_REPRICED', userId: req.usuario.id, meta: { clubs: clubs.length, round } });
  return res.json({ ok: true, clubs: clubs.length, round });
});

router.post('/suspender', async (req, res) => {
  const reason = String(req.body?.reason || 'Jogos ou processamento da rodada');
  const clubs = await Club.find({}).select('_id');
  for (const club of clubs) await cancelInstitutionalOrders(club._id);
  await InstitutionalLiquidity.updateMany({}, { $set: { institutionalSuspended: true, suspensionReason: reason } });
  await MarketLiquiditySettings.findOneAndUpdate({ key: 'default' }, { $set: { suspendedDuringMatches: true } }, { upsert: true });
  return res.json({ ok: true, reason });
});

router.post('/retomar', async (req, res) => {
  await InstitutionalLiquidity.updateMany({}, { $set: { institutionalSuspended: false, suspensionReason: null } });
  const clubs = await Club.find({}).sort({ legacyId: 1 });
  for (const club of clubs) await publishOrdersForClub(club, { round: req.body?.round ?? null });
  await MarketLiquiditySettings.findOneAndUpdate({ key: 'default' }, { $set: { suspendedDuringMatches: false } }, { upsert: true });
  return res.json({ ok: true });
});

router.patch('/configuracao', async (req, res) => {
  const allowed = ['operationalReserve', 'institutionalEnabled'];
  const update = {};
  for (const key of allowed) if (req.body?.[key] != null) update[key] = req.body[key];
  const settings = await MarketLiquiditySettings.findOneAndUpdate(
    { key: 'default' }, { $set: update }, { upsert: true, new: true, runValidators: true }
  );
  return res.json({ ok: true, settings });
});

router.patch('/clubes/:clubLegacyId', async (req, res) => {
  const club = await Club.findOne({ legacyId: Number(req.params.clubLegacyId) });
  if (!club) return res.status(404).json({ erro: 'Clube não encontrado.' });
  const state = await ensureLiquidityState(club);
  const allowed = [
    'visibleSellLot', 'replenishAt', 'sellMarginPct', 'buyDiscountPct',
    'dailyBuybackPerUser', 'dailyBuybackPerClub', 'minimumCoveragePct',
    'concentrationAboveAveragePct', 'institutionalSuspended', 'issuanceSuspended',
  ];
  for (const key of allowed) if (req.body?.[key] != null) state[key] = req.body[key];
  await state.save();
  await publishOrdersForClub(club);
  return res.json({ ok: true, state });
});

router.get('/ordens-internas', async (_req, res) => {
  const orders = await Order.find({ isInstitutional: true }).sort({ criadoEm: -1 }).limit(500).lean();
  return res.json({ ok: true, orders });
});

module.exports = router;

const mongoose = require('mongoose');

const InstitutionalLiquiditySchema = new mongoose.Schema(
  {
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true, unique: true, index: true },
    clubLegacyId: { type: Number, required: true, unique: true, index: true },
    maxShares: { type: Number, default: 1000 },
    issuedShares: { type: Number, default: 0 },
    institutionHeldIssuedShares: { type: Number, default: 0 },
    visibleSellLot: { type: Number, default: 20 },
    replenishAt: { type: Number, default: 5 },
    sellMarginPct: { type: Number, default: 0.02 },
    buyDiscountPct: { type: Number, default: 0.04 },
    dailyBuybackPerUser: { type: Number, default: 10 },
    dailyBuybackPerClub: { type: Number, default: 50 },
    minimumCoveragePct: { type: Number, default: 1.1 },
    concentrationAboveAveragePct: { type: Number, default: 0.25 },
    basePositionValue: { type: Number, default: 0 },
    institutionalAsk: { type: Number, default: 0 },
    institutionalBid: { type: Number, default: 0 },
    distributionGross: { type: Number, default: 0 },
    buybackGross: { type: Number, default: 0 },
    resaleGross: { type: Number, default: 0 },
    liquidationFund: { type: Number, default: 0 },
    dividendsReserve: { type: Number, default: 0 },
    liquidityReserve: { type: Number, default: 0 },
    institutionalSuspended: { type: Boolean, default: false, index: true },
    issuanceSuspended: { type: Boolean, default: false, index: true },
    suspensionReason: { type: String, default: null },
    lastRepricedAt: { type: Date, default: null },
    lastRepricedRound: { type: Number, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'institutional_liquidity' }
);

module.exports = mongoose.models.InstitutionalLiquidity ||
  mongoose.model('InstitutionalLiquidity', InstitutionalLiquiditySchema);

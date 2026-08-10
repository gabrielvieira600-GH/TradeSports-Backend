const mongoose = require('mongoose');

const MarketLiquiditySettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    operationalReserve: { type: Number, default: 50000 },
    institutionalEnabled: { type: Boolean, default: true },
    suspendedDuringMatches: { type: Boolean, default: false },
    lastGlobalRepriceAt: { type: Date, default: null },
    lastGlobalRepriceRound: { type: Number, default: null },
  },
  { timestamps: true, collection: 'market_liquidity_settings' }
);

module.exports = mongoose.models.MarketLiquiditySettings ||
  mongoose.model('MarketLiquiditySettings', MarketLiquiditySettingsSchema);

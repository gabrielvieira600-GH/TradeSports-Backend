const mongoose = require('mongoose');

const MarketControlSchema = new mongoose.Schema({
  ligaId: { type: String, required: true, unique: true, index: true },
  fechado: { type: Boolean, default: false, index: true },
  atualizadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, collection: 'market_controls' });

module.exports = mongoose.models.MarketControl || mongoose.model('MarketControl', MarketControlSchema);

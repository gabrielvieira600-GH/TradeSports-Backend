const mongoose = require('mongoose');

const InvestmentSchema = new mongoose.Schema(
  {
    legacyId: { type: String, index: true, unique: true, sparse: true },

    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    usuarioLegacyId: { type: Number, index: true },

    clubeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', index: true, default: null },
    clubeLegacyId: { type: Number, index: true, default: null },

    clubeNome: { type: String, default: '' },

    quantidade: { type: Number, default: 0 },
    precoUnitario: { type: Number, default: 0 },
    valorUnitario: { type: Number, default: 0 },
    totalPago: { type: Number, default: 0 },

    tipo: { type: String, required: true, index: true }, // IPO, COMPRA, VENDA, SAQUE, DEPOSITO, LIQUIDACAO, DIVIDENDO
    origem: { type: String, default: null },

    data: { type: Date, default: Date.now, index: true },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'investments',
  }
);

module.exports =
  mongoose.models.Investment || mongoose.model('Investment', InvestmentSchema);
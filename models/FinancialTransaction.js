const mongoose = require('mongoose');

const FinancialTransactionSchema = new mongoose.Schema(
  {
    legacyId: { type: String, unique: true, sparse: true, index: true },

    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    usuarioLegacyId: { type: Number, index: true },

    tipo: { type: String, enum: ['DEPOSITO', 'SAQUE'], required: true, index: true },

    valorBruto: { type: Number, required: true },
    taxa: { type: Number, default: 0 },
    valorLiquido: { type: Number, default: null },

    gateway: { type: String, default: 'manual' },
    gatewayReference: { type: String, default: null, index: true },

    status: {
      type: String,
      enum: ['PENDENTE', 'PROCESSANDO', 'CONFIRMADO', 'CANCELADO', 'FALHOU'],
      default: 'PENDENTE',
      index: true,
    },

    reconciliacaoStatus: {
      type: String,
      enum: ['PENDENTE', 'RECONCILIADO', 'FALHOU', null],
      default: null,
    },

    reconciliadoEm: { type: Date, default: null },
    ledgerEntryIds: { type: [String], default: [] },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'financial_transactions',
  }
);

module.exports =
  mongoose.models.FinancialTransaction ||
  mongoose.model('FinancialTransaction', FinancialTransactionSchema);
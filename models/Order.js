const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema(
  {
    legacyId: { type: String, unique: true, sparse: true, index: true },

    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    usuarioLegacyId: { type: Number, index: true },

    clubeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
    clubeLegacyId: { type: Number, index: true },

    tipo: { type: String, enum: ['compra', 'venda'], required: true, index: true },

    preco: { type: Number, required: true },
    quantidade: { type: Number, required: true },
    restante: { type: Number, required: true },

    status: {
      type: String,
      enum: ['aberta', 'executada', 'cancelada', 'parcial'],
      default: 'aberta',
      index: true,
    },

    criadoEm: { type: Date, default: Date.now, index: true },
    canceladoEm: { type: Date, default: null },
    executadoEm: { type: Date, default: null },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'orders',
  }
);

module.exports = mongoose.models.Order || mongoose.model('Order', OrderSchema);
const mongoose = require('mongoose');

const RecoveryRechargeSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    temporadaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RankingSeason',
      default: null,
      index: true,
    },
    quantidadeTs: { type: Number, required: true, min: 100 },
    valorReaisCentavos: { type: Number, required: true, min: 500 },
    patrimonioSolicitacao: { type: Number, required: true },
    patrimonioConfirmacao: { type: Number, default: null },
    provedor: { type: String, default: 'stripe', index: true },
    pagamentoId: { type: String, default: null, unique: true, sparse: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ['PENDENTE', 'PROCESSANDO', 'CONFIRMADA', 'EXPIRADA', 'CANCELADA', 'REEMBOLSADA', 'FALHA'],
      default: 'PENDENTE',
      index: true,
    },
    expiraEm: { type: Date, required: true, index: true },
    confirmadaEm: { type: Date, default: null },
    reembolsadaEm: { type: Date, default: null },
    motivoFalha: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'recovery_recharges' }
);

RecoveryRechargeSchema.index({ usuarioId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.RecoveryRecharge ||
  mongoose.model('RecoveryRecharge', RecoveryRechargeSchema);

const mongoose = require('mongoose');

const AdvancedAlertSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tipo: { type: String, required: true, enum: [
    'PRECO_ACIMA', 'PRECO_ABAIXO', 'VARIACAO_PERCENTUAL', 'MELHOR_BID',
    'MELHOR_ASK', 'SPREAD', 'ORDEM_EXECUCAO', 'IPO_ESGOTANDO',
    'CLASSIFICACAO', 'TOP4', 'DIVIDENDOS', 'LIQUIDACAO'
  ], index: true },
  nome: { type: String, required: true, trim: true, maxlength: 100 },
  clubeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', default: null, index: true },
  clubeLegacyId: { type: Number, default: null, index: true },
  clubeNome: { type: String, default: '' },
  ligaId: { type: String, default: null },
  ordemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  operador: { type: String, enum: ['ACIMA', 'ABAIXO', 'QUALQUER', 'ENTROU', 'SAIU'], default: 'QUALQUER' },
  valorAlvo: { type: Number, default: null },
  valorBase: { type: Number, default: null },
  canal: { type: String, enum: ['PLATAFORMA'], default: 'PLATAFORMA' },
  status: { type: String, enum: ['ATIVO', 'PAUSADO'], default: 'ATIVO', index: true },
  recorrente: { type: Boolean, default: true },
  cooldownMinutos: { type: Number, default: 60, min: 15, max: 10080 },
  ultimoDisparoEm: { type: Date, default: null },
  ultimoEstado: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, collection: 'advanced_alerts', versionKey: false });

AdvancedAlertSchema.index({ usuarioId: 1, status: 1, updatedAt: -1 });
module.exports = mongoose.models.AdvancedAlert || mongoose.model('AdvancedAlert', AdvancedAlertSchema);

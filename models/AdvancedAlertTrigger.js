const mongoose = require('mongoose');

const AdvancedAlertTriggerSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  alertaId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdvancedAlert', required: true, index: true },
  tipo: { type: String, required: true, index: true },
  titulo: { type: String, required: true },
  mensagem: { type: String, required: true },
  valorObservado: { type: Number, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  disparadoEm: { type: Date, default: Date.now, index: true },
}, { collection: 'advanced_alert_triggers', versionKey: false });

AdvancedAlertTriggerSchema.index({ usuarioId: 1, disparadoEm: -1 });
module.exports = mongoose.models.AdvancedAlertTrigger || mongoose.model('AdvancedAlertTrigger', AdvancedAlertTriggerSchema);

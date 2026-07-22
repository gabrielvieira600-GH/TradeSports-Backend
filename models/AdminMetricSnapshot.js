const mongoose = require('mongoose');

const AdminMetricSnapshotSchema = new mongoose.Schema(
  {
    mes: { type: String, required: true, unique: true, index: true },
    inicio: { type: Date, required: true },
    fim: { type: Date, required: true },
    fechado: { type: Boolean, default: false, index: true },
    metricas: { type: mongoose.Schema.Types.Mixed, default: {} },
    semanas: { type: [mongoose.Schema.Types.Mixed], default: [] },
    calculadoEm: { type: Date, default: Date.now },
    fechadoEm: { type: Date, default: null },
    versao: { type: Number, default: 1 },
  },
  { collection: 'admin_metric_snapshots', versionKey: false }
);

module.exports =
  mongoose.models.AdminMetricSnapshot ||
  mongoose.model('AdminMetricSnapshot', AdminMetricSnapshotSchema);
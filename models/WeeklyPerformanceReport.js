const mongoose = require('mongoose');

const WeeklyPerformanceReportSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    chaveSemana: { type: String, required: true },
    inicio: { type: Date, required: true, index: true },
    fim: { type: Date, required: true },
    geradoEm: { type: Date, default: Date.now },
    resumo: { type: mongoose.Schema.Types.Mixed, default: {} },
    clubesImpacto: { type: [mongoose.Schema.Types.Mixed], default: [] },
    exposicao: { type: mongoose.Schema.Types.Mixed, default: {} },
    ranking: { type: mongoose.Schema.Types.Mixed, default: {} },
    alertasProximaRodada: { type: [mongoose.Schema.Types.Mixed], default: [] },
    qualidadeDados: { type: mongoose.Schema.Types.Mixed, default: {} },
    metodologia: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'weekly_performance_reports' }
);

WeeklyPerformanceReportSchema.index(
  { usuarioId: 1, chaveSemana: 1 },
  { unique: true, name: 'relatorio_semanal_usuario_unique' }
);

module.exports =
  mongoose.models.WeeklyPerformanceReport ||
  mongoose.model('WeeklyPerformanceReport', WeeklyPerformanceReportSchema);

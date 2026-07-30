const mongoose = require('mongoose');

const PerformanceSnapshotSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    data: { type: Date, required: true, index: true },
    chaveDia: { type: String, required: true },
    patrimonio: { type: Number, required: true },
    saldo: { type: Number, required: true },
    valorPosicoes: { type: Number, required: true },
    resultadoAcumulado: { type: Number, default: 0 },
    rentabilidadeAcumulada: { type: Number, default: 0 },
    quantidadePosicoes: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'performance_snapshots',
    versionKey: false,
  }
);

PerformanceSnapshotSchema.index(
  { usuarioId: 1, chaveDia: 1 },
  { unique: true, name: 'performance_usuario_dia_unique' }
);

module.exports =
  mongoose.models.PerformanceSnapshot ||
  mongoose.model('PerformanceSnapshot', PerformanceSnapshotSchema);

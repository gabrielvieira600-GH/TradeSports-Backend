const mongoose = require('mongoose');

const SplitSchema = new mongoose.Schema(
  {
    ratio: { type: Number, required: true },
    data: { type: Date, required: true },
    motivo: { type: String, default: null },
  },
  { _id: false }
);

const ClubSchema = new mongoose.Schema(
  {
    legacyId: { type: Number, unique: true, index: true, required: true },

    nome: { type: String, required: true, index: true },
    nomeApi: { type: String, default: '', index: true },
    escudo: { type: String, default: '' },

    posicao: { type: Number, default: null },

    preco: { type: Number, required: true, default: 0 },
    precoAtual: { type: Number, default: null },

    cotasDisponiveis: { type: Number, default: 1000 },
    cotasEmitidas: { type: Number, default: 0 },
    ipoEncerrado: { type: Boolean, default: false },

    splitFactorCumulativo: { type: Number, default: 1 },
    splits: { type: [SplitSchema], default: [] },

    travadoAte: { type: Number, default: 0 },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'clubs',
  }
);

ClubSchema.pre('save', function (next) {
  if (!this.nomeApi) this.nomeApi = this.nome;
  next();
});

ClubSchema.index({ nomeApi: 1 });
ClubSchema.index({ posicao: 1 });

module.exports = mongoose.models.Club || mongoose.model('Club', ClubSchema);
const mongoose = require('mongoose');

const TrophySchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },

    periodoTipo: {
      type: String,
      enum: ['semana', 'mes', 'temporada'],
      required: true,
      index: true,
    },

    periodoChave: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    periodoLabel: {
      type: String,
      required: true,
      trim: true,
    },

    categoria: {
      type: String,
      enum: ['geral', 'premium', 'privado'],
      required: true,
      index: true,
    },

    posicao: {
      type: Number,
      enum: [1, 2, 3],
      required: true,
      index: true,
    },

    rankingPrivadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PrivateRanking',
      default: null,
      index: true,
    },

    rankingNome: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120,
    },

    titulo: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },

    descricao: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    designKey: {
      type: String,
      required: true,
      trim: true,
    },

    uniqueKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    metricas: {
      patrimonio: { type: Number, default: null },
      resultado: { type: Number, default: null },
      rentabilidade: { type: Number, default: null },
      criterio: { type: String, default: 'rentabilidade' },
    },

    concedidoEm: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'trophies',
  }
);

TrophySchema.index({
  usuarioId: 1,
  concedidoEm: -1,
});

TrophySchema.index({
  temporadaId: 1,
  periodoTipo: 1,
  periodoChave: 1,
  categoria: 1,
});

module.exports =
  mongoose.models.Trophy || mongoose.model('Trophy', TrophySchema);

const mongoose = require('mongoose');

const PrivateRankingSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },

    descricao: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },

    imagemUrl: {
      type: String,
      default: '',
      trim: true,
    },

    criadorId: {
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

    codigoConvite: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },

    status: {
      type: String,
      enum: ['ativo', 'cancelado', 'encerrado'],
      default: 'ativo',
      index: true,
    },

    maxParticipantes: {
      type: Number,
      default: 50,
      min: 2,
      max: 500,
    },

    aprovacaoManual: {
      type: Boolean,
      default: false,
    },

    dataInicio: {
      type: Date,
      default: Date.now,
    },

    dataFim: {
      type: Date,
      default: null,
    },

    totalParticipantes: {
      type: Number,
      default: 0,
    },

    configuracoes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'private_rankings',
  }
);

PrivateRankingSchema.index({
  criadorId: 1,
  status: 1,
  createdAt: -1,
});

PrivateRankingSchema.index({
  temporadaId: 1,
  status: 1,
  createdAt: -1,
});

module.exports =
  mongoose.models.PrivateRanking ||
  mongoose.model('PrivateRanking', PrivateRankingSchema);
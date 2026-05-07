const mongoose = require('mongoose');

const LiquidacaoSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    usuarioLegacyId: {
      type: Number,
      default: null,
      index: true,
    },

    clubeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Club',
      required: true,
      index: true,
    },

    clubeLegacyId: {
      type: Number,
      default: null,
      index: true,
    },

    clubeNome: {
      type: String,
      default: '',
    },

    campeonato: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    temporada: {
      type: Number,
      required: true,
      index: true,
    },

    posicaoFinal: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
    },

    quantidade: {
      type: Number,
      required: true,
      min: 0,
    },

    precoLiquidacaoBase: {
      type: Number,
      required: true,
      min: 0,
    },

    splitFactorCumulativo: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    precoLiquidacao: {
      type: Number,
      required: true,
      min: 0,
    },

    totalRecebido: {
      type: Number,
      required: true,
      min: 0,
    },

    saldoAntes: {
      type: Number,
      min: 0,
      default: 0,
    },

    saldoDepois: {
      type: Number,
      min: 0,
      default: 0,
    },

    quantidadeAntesLiquidacao: {
      type: Number,
      min: 0,
      default: 0,
    },

    quantidadeDepoisLiquidacao: {
      type: Number,
      min: 0,
      default: 0,
    },

    ledgerEntryId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    idemKey: {
      type: String,
      trim: true,
      required: true,
      unique: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['processada', 'revertida'],
      default: 'processada',
      index: true,
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    dataLiquidacao: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'liquidacoes',
  }
);

LiquidacaoSchema.index({
  campeonato: 1,
  temporada: 1,
  clubeId: 1,
  usuarioId: 1,
});

LiquidacaoSchema.index({
  campeonato: 1,
  temporada: 1,
  clubeLegacyId: 1,
  usuarioLegacyId: 1,
});

LiquidacaoSchema.index({
  dataLiquidacao: -1,
  status: 1,
});

module.exports =
  mongoose.models.Liquidacao ||
  mongoose.model('Liquidacao', LiquidacaoSchema);
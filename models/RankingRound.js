const mongoose = require('mongoose');

const RankingRoundSchema = new mongoose.Schema(
  {
    temporadaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RankingSeason',
      required: true,
      index: true,
    },

    numero: {
      type: Number,
      required: true,
      min: 1,
    },

    nome: {
      type: String,
      default: '',
      trim: true,
    },

    status: {
      type: String,
      enum: [
        'agendada',
        'aberta',
        'encerrada',
        'cancelada',
      ],
      default: 'agendada',
      index: true,
    },

    limiteOrdensLite: {
      type: Number,
      default: 15,
      min: 1,
    },

    inicioPrevisto: {
      type: Date,
      default: null,
    },

    fimPrevisto: {
      type: Date,
      default: null,
    },

    abertaEm: {
      type: Date,
      default: null,
    },

    encerradaEm: {
      type: Date,
      default: null,
    },

    criadaPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    abertaPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    encerradaPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    observacoes: {
      type: String,
      default: '',
      trim: true,
    },

    configuracoes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'ranking_rounds',
  }
);

RankingRoundSchema.index(
  {
    temporadaId: 1,
    numero: 1,
  },
  {
    unique: true,
  }
);

RankingRoundSchema.index({
  temporadaId: 1,
  status: 1,
});

RankingRoundSchema.pre('validate', function (next) {
  if (
    this.inicioPrevisto &&
    this.fimPrevisto &&
    this.fimPrevisto <= this.inicioPrevisto
  ) {
    return next(
      new Error(
        'A data final da rodada deve ser posterior à data inicial.'
      )
    );
  }

  if (
    this.abertaEm &&
    this.encerradaEm &&
    this.encerradaEm <= this.abertaEm
  ) {
    return next(
      new Error(
        'A data de encerramento deve ser posterior à abertura da rodada.'
      )
    );
  }

  return next();
});

RankingRoundSchema.statics.buscarRodadaAberta =
  function (temporadaId) {
    return this.findOne({
      temporadaId,
      status: 'aberta',
    }).sort({
      numero: -1,
    });
  };

module.exports =
  mongoose.models.RankingRound ||
  mongoose.model(
    'RankingRound',
    RankingRoundSchema
  );
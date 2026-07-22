const mongoose = require('mongoose');

const RankingSeasonSchema = new mongoose.Schema(
  {
    codigo: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },

    nome: {
      type: String,
      required: true,
      trim: true,
    },

    descricao: {
      type: String,
      default: '',
      trim: true,
    },

    status: {
      type: String,
      enum: [
        'rascunho',
        'ativa',
        'encerrada',
        'cancelada',
      ],
      default: 'rascunho',
      index: true,
    },

    capitalInicial: {
      type: Number,
      default: 1000,
      min: 0,
    },

    limiteOrdensLitePorRodada: {
      type: Number,
      default: 15,
      min: 1,
    },

    // Regra vigente. O campo acima permanece apenas para compatibilidade
    // com temporadas criadas antes da adoção da quota semanal.
    limiteOrdensLiteSemanal: {
      type: Number,
      default: 15,
      min: 1,
    },

    rodadaAtual: {
      type: Number,
      default: null,
      min: 1,
    },

    totalRodadas: {
      type: Number,
      default: null,
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

    iniciadaEm: {
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

    iniciadaPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    encerradaPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    configuracoes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'ranking_seasons',
  }
);

RankingSeasonSchema.index({
  status: 1,
  inicioPrevisto: 1,
  fimPrevisto: 1,
});

RankingSeasonSchema.pre('validate', function (next) {
  if (
    this.inicioPrevisto &&
    this.fimPrevisto &&
    this.fimPrevisto <= this.inicioPrevisto
  ) {
    return next(
      new Error(
        'A data final da temporada deve ser posterior à data inicial.'
      )
    );
  }

  if (
    this.iniciadaEm &&
    this.encerradaEm &&
    this.encerradaEm <= this.iniciadaEm
  ) {
    return next(
      new Error(
        'A data de encerramento deve ser posterior à data de início da temporada.'
      )
    );
  }

  return next();
});

RankingSeasonSchema.statics.buscarTemporadaAtiva =
  function () {
    return this.findOne({
      status: 'ativa',
    }).sort({
      iniciadaEm: -1,
      createdAt: -1,
    });
  };

module.exports =
  mongoose.models.RankingSeason ||
  mongoose.model(
    'RankingSeason',
    RankingSeasonSchema
  );

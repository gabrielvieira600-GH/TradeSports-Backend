const mongoose = require('mongoose');

const UserTradingQuotaSchema = new mongoose.Schema(
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
      enum: ['semanal'],
      default: 'semanal',
      required: true,
    },

    periodoChave: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    periodoInicio: {
      type: Date,
      required: true,
      index: true,
    },

    periodoFim: {
      type: Date,
      required: true,
      index: true,
    },

    timezone: {
      type: String,
      default: 'America/Sao_Paulo',
      required: true,
    },

    planoNoMomento: {
      type: String,
      enum: ['lite', 'premium'],
      required: true,
      default: 'lite',
    },

    // Franquia semanal normal do plano Lite, sem publicidade premiada.
    limiteBaseOrdens: {
      type: Number,
      default: 15,
      min: 1,
    },

    // Limite efetivo usado pelo motor: limiteBaseOrdens + bonusOrdens.
    // Mantido como campo persistido para retrocompatibilidade com o mercado.
    limiteOrdens: {
      type: Number,
      default: 15,
      min: 1,
    },

    // Bônus obtido via rewarded ads na semana (máximo 10 = 5 x 2).
    bonusOrdens: {
      type: Number,
      default: 0,
      min: 0,
      max: 10,
    },

    rewardedAdsConcluidos: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    ultimoRewardedAdEm: {
      type: Date,
      default: null,
    },

    ordensUtilizadas: {
      type: Number,
      default: 0,
      min: 0,
    },

    primeiraOrdemEm: {
      type: Date,
      default: null,
    },

    ultimaOrdemEm: {
      type: Date,
      default: null,
    },

    limiteAtingidoEm: {
      type: Date,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'user_trading_quotas',
  }
);

UserTradingQuotaSchema.index(
  {
    usuarioId: 1,
    temporadaId: 1,
    periodoChave: 1,
  },
  {
    unique: true,
    name: 'usuario_temporada_periodo_unique',
  }
);

UserTradingQuotaSchema.index({
  temporadaId: 1,
  periodoInicio: -1,
});

UserTradingQuotaSchema.index({
  usuarioId: 1,
  periodoInicio: -1,
});

module.exports =
  mongoose.models.UserTradingQuota ||
  mongoose.model('UserTradingQuota', UserTradingQuotaSchema);

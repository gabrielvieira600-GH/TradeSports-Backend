const mongoose = require('mongoose');

const RewardedAdEventSchema = new mongoose.Schema(
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

    quotaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserTradingQuota',
      required: true,
      index: true,
    },

    periodoChave: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    provider: {
      type: String,
      default: 'google-ad-manager-web',
      required: true,
    },

    featureKey: {
      type: String,
      default: 'lite_weekly_orders',
      required: true,
    },

    rewardType: {
      type: String,
      enum: ['orders'],
      default: 'orders',
      required: true,
    },

    rewardAmount: {
      type: Number,
      default: 2,
      required: true,
      min: 1,
      max: 2,
    },

    attemptId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    // Nunca é retornado pela API. O navegador recebe apenas o token bruto
    // correspondente e o backend armazena somente seu SHA-256.
    tokenHash: {
      type: String,
      required: true,
      select: false,
    },

    status: {
      type: String,
      enum: ['pending', 'rewarded', 'cancelled', 'expired'],
      default: 'pending',
      required: true,
      index: true,
    },

    iniciadoEm: {
      type: Date,
      default: Date.now,
      required: true,
    },

    expiraEm: {
      type: Date,
      required: true,
      index: true,
    },

    rewardedAt: {
      type: Date,
      default: null,
    },

    closedAt: {
      type: Date,
      default: null,
    },

    providerRewardType: {
      type: String,
      default: '',
      maxlength: 120,
    },

    providerRewardAmount: {
      type: Number,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'rewarded_ad_events',
  }
);

RewardedAdEventSchema.index({
  usuarioId: 1,
  periodoChave: 1,
  status: 1,
  createdAt: -1,
});

RewardedAdEventSchema.index({
  usuarioId: 1,
  temporadaId: 1,
  periodoChave: 1,
  rewardedAt: -1,
});

module.exports =
  mongoose.models.RewardedAdEvent ||
  mongoose.model('RewardedAdEvent', RewardedAdEventSchema);

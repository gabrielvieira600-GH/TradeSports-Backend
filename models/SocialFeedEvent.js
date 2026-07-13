const mongoose = require('mongoose');

const SocialFeedEventSchema = new mongoose.Schema(
  {
    tipo: {
      type: String,
      required: true,
      index: true,
      enum: [
  'FOLLOW_USER',
  'PRIVATE_RANKING_CREATED',
  'PRIVATE_RANKING_JOINED',
  'RANKING_TOP_ACHIEVED',
  'MILESTONE_RENTABILITY',
  'SYSTEM',
],
    },

    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    usuarioAlvoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    rankingPrivadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PrivateRanking',
      default: null,
      index: true,
    },

    clubeId: {
      type: Number,
      default: null,
      index: true,
    },

    titulo: {
      type: String,
      default: '',
      trim: true,
      maxlength: 140,
    },

    mensagem: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },

    targetUrl: {
      type: String,
      default: '',
      trim: true,
      maxlength: 300,
    },

    visibilidade: {
      type: String,
      enum: ['publico', 'seguidores', 'privado'],
      default: 'publico',
      index: true,
    },

    status: {
      type: String,
      enum: ['ativo', 'oculto', 'removido'],
      default: 'ativo',
      index: true,
    },

    relevancia: {
      type: Number,
      default: 0,
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'social_feed_events',
  }
);

SocialFeedEventSchema.index({
  status: 1,
  visibilidade: 1,
  createdAt: -1,
});

SocialFeedEventSchema.index({
  usuarioId: 1,
  createdAt: -1,
});

SocialFeedEventSchema.index({
  usuarioAlvoId: 1,
  createdAt: -1,
});

SocialFeedEventSchema.index({
  tipo: 1,
  createdAt: -1,
});

SocialFeedEventSchema.index({
  relevancia: -1,
  createdAt: -1,
});

module.exports =
  mongoose.models.SocialFeedEvent ||
  mongoose.model('SocialFeedEvent', SocialFeedEventSchema);
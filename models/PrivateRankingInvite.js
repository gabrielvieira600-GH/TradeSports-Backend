const mongoose = require('mongoose');

const PrivateRankingInviteSchema = new mongoose.Schema(
  {
    rankingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PrivateRanking',
      required: true,
      index: true,
    },

    remetenteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    destinatarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        'pendente',
        'aceito',
        'recusado',
        'cancelado',
        'expirado',
      ],
      default: 'pendente',
      index: true,
    },

    mensagem: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },

    enviadoEm: {
      type: Date,
      default: Date.now,
    },

    respondidoEm: {
      type: Date,
      default: null,
    },

    aceitoEm: {
      type: Date,
      default: null,
    },

    recusadoEm: {
      type: Date,
      default: null,
    },

    canceladoEm: {
      type: Date,
      default: null,
    },

    expiradoEm: {
      type: Date,
      default: null,
    },

    expiraEm: {
      type: Date,
      default: null,
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'private_ranking_invites',
  }
);

PrivateRankingInviteSchema.index(
  {
    rankingId: 1,
    destinatarioId: 1,
    status: 1,
  },
  {
    name: 'ranking_destinatario_status_idx',
  }
);

PrivateRankingInviteSchema.index({
  destinatarioId: 1,
  status: 1,
  createdAt: -1,
});

PrivateRankingInviteSchema.index({
  remetenteId: 1,
  status: 1,
  createdAt: -1,
});

PrivateRankingInviteSchema.index({
  rankingId: 1,
  status: 1,
  createdAt: -1,
});

PrivateRankingInviteSchema.pre('validate', function (next) {
  if (
    this.remetenteId &&
    this.destinatarioId &&
    String(this.remetenteId) === String(this.destinatarioId)
  ) {
    return next(
      new Error('O usuário não pode convidar a si mesmo para um ranking privado.')
    );
  }

  return next();
});

module.exports =
  mongoose.models.PrivateRankingInvite ||
  mongoose.model(
    'PrivateRankingInvite',
    PrivateRankingInviteSchema
  );
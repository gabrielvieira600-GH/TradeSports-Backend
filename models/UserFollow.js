const mongoose = require('mongoose');

const UserFollowSchema = new mongoose.Schema(
  {
    seguidorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    seguidoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['ativo', 'bloqueado', 'removido'],
      default: 'ativo',
      index: true,
    },

    seguidoEm: {
      type: Date,
      default: Date.now,
    },

    removidoEm: {
      type: Date,
      default: null,
    },

    bloqueadoEm: {
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
    collection: 'user_follows',
  }
);

UserFollowSchema.index(
  {
    seguidorId: 1,
    seguidoId: 1,
  },
  {
    unique: true,
    name: 'seguidor_seguido_unique',
  }
);

UserFollowSchema.index({
  seguidoId: 1,
  status: 1,
});

UserFollowSchema.index({
  seguidorId: 1,
  status: 1,
});

UserFollowSchema.pre('validate', function (next) {
  if (
    this.seguidorId &&
    this.seguidoId &&
    String(this.seguidorId) === String(this.seguidoId)
  ) {
    return next(
      new Error('O usuário não pode seguir a si mesmo.')
    );
  }

  return next();
});

module.exports =
  mongoose.models.UserFollow ||
  mongoose.model('UserFollow', UserFollowSchema);
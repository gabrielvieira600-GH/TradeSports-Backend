const mongoose = require('mongoose');

const PushSubscriptionSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: '', maxlength: 500 },
    ativo: { type: Boolean, default: true, index: true },
    ultimoSucessoEm: { type: Date, default: null },
    ultimaFalhaEm: { type: Date, default: null },
    ultimoErro: { type: String, default: '', maxlength: 500 },
  },
  {
    timestamps: true,
    collection: 'push_subscriptions',
  }
);

PushSubscriptionSchema.index({ usuarioId: 1, ativo: 1, updatedAt: -1 });

module.exports =
  mongoose.models.PushSubscription ||
  mongoose.model('PushSubscription', PushSubscriptionSchema);

const mongoose = require('mongoose');

const UserSessionSchema = new mongoose.Schema({
  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    select: false,
  },
  criadoEm: { type: Date, default: Date.now },
  ultimoUsoEm: { type: Date, default: Date.now },
  revogadoEm: { type: Date, default: null, index: true },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
}, {
  timestamps: true,
  collection: 'user_sessions',
});

module.exports = mongoose.models.UserSession || mongoose.model('UserSession', UserSessionSchema);

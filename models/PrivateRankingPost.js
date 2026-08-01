const mongoose = require('mongoose');

const PrivateRankingPostSchema = new mongoose.Schema({
  rankingId: { type: mongoose.Schema.Types.ObjectId, ref: 'PrivateRanking', required: true, index: true },
  autorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  texto: { type: String, required: true, trim: true, maxlength: 1500 },
  status: { type: String, enum: ['ativo', 'removido'], default: 'ativo', index: true },
  removidoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  removidoEm: { type: Date, default: null },
}, { timestamps: true, collection: 'private_ranking_posts' });

PrivateRankingPostSchema.index({ rankingId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.PrivateRankingPost || mongoose.model('PrivateRankingPost', PrivateRankingPostSchema);

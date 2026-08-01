const mongoose = require('mongoose');

const PrivateRankingMemberSchema = new mongoose.Schema(
  {
    rankingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PrivateRanking',
      required: true,
      index: true,
    },

    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ['pendente', 'aprovado', 'recusado', 'removido', 'bloqueado', 'saiu'],
      default: 'aprovado',
      index: true,
    },

    papel: {
      type: String,
      enum: ['proprietario', 'administrador', 'participante'],
      default: 'participante',
      index: true,
    },

    trofeus: [{
      tipo: { type: String, trim: true },
      titulo: { type: String, trim: true },
      concedidoEm: { type: Date, default: Date.now },
      temporadaId: { type: mongoose.Schema.Types.ObjectId, ref: 'RankingSeason', default: null },
    }],

    entrouEm: {
      type: Date,
      default: Date.now,
    },

    convidadoEm: {
      type: Date,
      default: null,
    },

    aprovadoEm: {
      type: Date,
      default: null,
    },

    aprovadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    recusadoEm: {
      type: Date,
      default: null,
    },

    recusadoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    removidoEm: {
      type: Date,
      default: null,
    },

    removidoPor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    saiuEm: {
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
    collection: 'private_ranking_members',
  }
);

PrivateRankingMemberSchema.index(
  {
    rankingId: 1,
    usuarioId: 1,
  },
  {
    unique: true,
    name: 'ranking_usuario_unique',
  }
);

PrivateRankingMemberSchema.index({
  usuarioId: 1,
  status: 1,
  createdAt: -1,
});

PrivateRankingMemberSchema.index({
  rankingId: 1,
  status: 1,
  createdAt: -1,
});

module.exports =
  mongoose.models.PrivateRankingMember ||
  mongoose.model(
    'PrivateRankingMember',
    PrivateRankingMemberSchema
  );

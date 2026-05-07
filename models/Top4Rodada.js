// models/Top4Rodada.js
const mongoose = require('mongoose');

const Top4ClubeSchema = new mongoose.Schema(
  {
    clubeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Club',
      required: true,
      index: true,
    },

    clubeLegacyId: {
      type: Number,
      default: null,
      index: true,
    },

    posicao: {
      type: Number,
      required: true,
      min: 1,
      max: 4,
    },
  },
  { _id: false }
);

const Top4RodadaSchema = new mongoose.Schema(
  {
    rodada: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },

    clubes: {
      type: [Top4ClubeSchema],
      default: [],
    },

    data: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: 'top4_rodadas',
    timestamps: true,
    versionKey: false,
  }
);

Top4RodadaSchema.index({ rodada: 1, 'clubes.clubeLegacyId': 1 });

module.exports =
  mongoose.models.Top4Rodada ||
  mongoose.model('Top4Rodada', Top4RodadaSchema);
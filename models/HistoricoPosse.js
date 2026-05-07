// models/HistoricoPosse.js

const mongoose = require('mongoose');

const HistoricoPosseSchema = new mongoose.Schema(

  {

    usuarioId: {

      type: mongoose.Schema.Types.ObjectId,

      ref: 'User',

      required: true,

      index: true,

    },

    usuarioLegacyId: {

      type: Number,

      default: null,

      index: true,

    },

    clubeId: {

      type: mongoose.Schema.Types.ObjectId,

      ref: 'Club',

      required: true,

      index: true,

    },

    clubeLegacyId: {

      type: Number,

      required: true,

      index: true,

    },

    rodada: {

      type: Number,

      required: true,

      index: true,

    },

    quantidade: {

      type: Number,

      required: true,

      min: 0,

    },

    data: {

      type: Date,

      default: Date.now,

      index: true,

    },

  },

  {

    collection: 'historico_posse',

    versionKey: false,

    timestamps: true,

  }

);

HistoricoPosseSchema.index(

  { usuarioId: 1, clubeId: 1, rodada: 1 },

  { unique: true }

);

HistoricoPosseSchema.index(

  { usuarioLegacyId: 1, clubeLegacyId: 1, rodada: 1 }

);

module.exports =

  mongoose.models.HistoricoPosse ||

  mongoose.model('HistoricoPosse', HistoricoPosseSchema);
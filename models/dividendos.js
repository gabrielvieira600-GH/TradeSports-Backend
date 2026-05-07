// models/dividendos.js
const mongoose = require('mongoose');

const DividendoSchema = new mongoose.Schema(

  {

    usuarioId: {

      type: mongoose.Schema.Types.ObjectId,

      ref: 'User',

      required: true,

      index: true,

    },

    clubeId: {

      type: mongoose.Schema.Types.ObjectId,

      ref: 'Club',

      required: true,

      index: true,

    },

    usuarioLegacyId: {

      type: Number,

      default: null,

      index: true,

    },

    clubeLegacyId: {

      type: Number,

      default: null,

      index: true,

    },

    clubeNome: {

      type: String,

      default: '',

    },

    rodada: {

      type: Number,

      default: null,

      index: true,

    },

    posicao: {

      type: Number,

      default: null,

      index: true,

    },

    origem: {

      type: String,

      default: 'RODADA',

      index: true,

    },

    quantidade: {

      type: Number,

      required: true,

    },

    valorUnitario: {

      type: Number,

      required: true,

    },

    totalPago: {

      type: Number,

      required: true,

    },

    idemKey: {

      type: String,

      required: true,

      unique: true,

      index: true,

    },

    data: {

      type: Date,

      default: Date.now,

      index: true,

    },

    meta: {

      type: mongoose.Schema.Types.Mixed,

      default: {},

    },

  },

  {

    collection: 'dividendos',

    timestamps: true,

    versionKey: false,

  }

);

DividendoSchema.index({

  usuarioId: 1,

  clubeId: 1,

  rodada: 1,

  posicao: 1,

});

module.exports =

  mongoose.models.Dividendo || mongoose.model('Dividendo', DividendoSchema);
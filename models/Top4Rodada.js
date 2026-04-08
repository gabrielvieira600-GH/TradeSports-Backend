// models/Top4Rodada.js

const mongoose = require('mongoose');

const Top4RodadaSchema = new mongoose.Schema({
  rodada: {
    type: Number,
    required: true                // Número da rodada
  },
  clubes: [
    {
      clube: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Clube',
        required: true
      },
      posicao: {
        type: Number,
        required: true            // 1, 2, 3 ou 4
      }
    }
  ],
  data: {
    type: Date,
    default: Date.now             // Data de registro da rodada
  }
});

module.exports = mongoose.model('Top4Rodada', Top4RodadaSchema);

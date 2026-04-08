// models/Investimento.js

const mongoose = require('mongoose');

const InvestimentoSchema = new mongoose.Schema({
  usuario: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  clube: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clube',
    required: true
  },
  quantidade: {
    type: Number,
    required: true
  },
  precoUnitario: {
    type: Number,
    required: true
  },
  tipo: {
    type: String,
    enum: ['IPO', 'mercado_secundario'],
    default: 'IPO'
  },
  dataCompra: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Investimento', InvestimentoSchema);

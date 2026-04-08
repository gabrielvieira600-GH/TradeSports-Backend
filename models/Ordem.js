// models/Ordem.js

const mongoose = require('mongoose');

const OrdemSchema = new mongoose.Schema({
  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  clubeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clube',
    required: true
  },
  tipo: {
    type: String,
    enum: ['compra', 'venda'], // Garante que seja apenas compra ou venda
    required: true
  },
  preco: {
    type: Number,
    required: true            // Preço por cota ofertado
  },
  quantidade: {
    type: Number,
    required: true            // Quantidade de cotas
  },
  data: {
    type: Date,
    default: Date.now         // Data da criação da ordem
  }
});

module.exports = mongoose.model('Ordem', OrdemSchema);

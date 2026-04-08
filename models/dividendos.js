// models/dividendos.js

const mongoose = require('mongoose');

const DividendoSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  clubeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clube', required: true },
  quantidade: { type: Number, required: true },         // Quantidade de cotas com direito ao dividendo
  valorUnitario: { type: Number, required: true },      // Valor por cota
  totalPago: { type: Number, required: true },          // quantidade * valorUnitario
  data: { type: Date, default: Date.now }               // Data de distribuição
});

module.exports = mongoose.model('Dividendo', DividendoSchema);

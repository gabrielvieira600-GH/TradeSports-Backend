// models/HistoricoPosse.js

const mongoose = require('mongoose');

const HistoricoPosseSchema = new mongoose.Schema({
  usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  clubeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clube', required: true },
  rodada: { type: Number, required: true },               // Número da rodada em que foi registrado
  quantidade: { type: Number, required: true },           // Quantidade de cotas em posse
  data: { type: Date, default: Date.now }                 // Data do registro
});

module.exports = mongoose.model('HistoricoPosse', HistoricoPosseSchema);

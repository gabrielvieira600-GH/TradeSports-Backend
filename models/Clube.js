// models/Clube.js

const mongoose = require('mongoose');

const ClubeSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },           // ID da API-Football
  nome: { type: String, required: true },
  escudo: { type: String, required: true },                     // URL do escudo ou nome do arquivo
  posicao: { type: Number, required: true },
  preco: { type: Number, required: true },                      // Valor fixo do IPO conforme posição
  precoAtual: { type: Number, required: true },                 // Valor do mercado secundário
  cotasDisponiveis: { type: Number, default: 1000 },            // Começa com 1000 cotas para IPO
  ipoEncerrado: { type: Boolean, default: false }               // Fase do IPO (ativa ou encerrada)
});

module.exports = mongoose.model('Clube', ClubeSchema);

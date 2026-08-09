const BASE_PRICE = 5;
const GROWTH_FACTOR = 1.05;

function calcularPrecoPorPosicao(posicao, totalParticipantes = 20) {
  const total = Number(totalParticipantes);
  const pos = Number(posicao);
  if (!Number.isInteger(total) || total < 1) throw new Error('Total de participantes inválido.');
  if (!Number.isInteger(pos) || pos < 1 || pos > total) return BASE_PRICE;
  return Number((BASE_PRICE * Math.pow(GROWTH_FACTOR, total - pos)).toFixed(2));
}

module.exports = { BASE_PRICE, GROWTH_FACTOR, calcularPrecoPorPosicao };

const BASE_PRICE = 5;
const GROWTH_FACTOR = 1.05;
const TICK_SIZE = 0.05;

function ajustarAoTick(valor) {
  return Number((Math.round(Number(valor) / TICK_SIZE) * TICK_SIZE).toFixed(2));
}

function calcularPrecoPorPosicao(posicao, totalParticipantes = 20) {
  const total = Number(totalParticipantes);
  const pos = Number(posicao);
  if (!Number.isInteger(total) || total < 1) throw new Error('Total de participantes inválido.');
  if (!Number.isInteger(pos) || pos < 1 || pos > total) return BASE_PRICE;
  return ajustarAoTick(BASE_PRICE * Math.pow(GROWTH_FACTOR, total - pos));
}

module.exports = { BASE_PRICE, GROWTH_FACTOR, TICK_SIZE, ajustarAoTick, calcularPrecoPorPosicao };

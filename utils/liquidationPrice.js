const BASE_PRICE = 5;
const GROWTH_FACTOR = 1.05;
const TICK_SIZE = 0.05;

function ajustarAoTick(valor) {
  const centavos = Math.round(Number(valor) * 100);
  return Number(((Math.floor(centavos / 5) * 5) / 100).toFixed(2));
}

function calcularPrecoPorPosicao(posicao, totalParticipantes = 20) {
  const total = Number(totalParticipantes);
  const pos = Number(posicao);
  if (!Number.isInteger(total) || total < 1) throw new Error('Total de participantes inválido.');
  if (!Number.isInteger(pos) || pos < 1 || pos > total) return BASE_PRICE;
  return ajustarAoTick(BASE_PRICE * Math.pow(GROWTH_FACTOR, total - pos));
}

module.exports = { BASE_PRICE, GROWTH_FACTOR, TICK_SIZE, ajustarAoTick, calcularPrecoPorPosicao };

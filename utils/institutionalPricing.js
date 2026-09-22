const TICK_SIZE = 0.05;
const DEFAULT_USER_ORDER_BAND_PCT = 0.10;
const round2 = (value) => Number(Number(value || 0).toFixed(2));
const tickUp = (value) => round2(Math.ceil((Number(value) - 1e-9) / TICK_SIZE) * TICK_SIZE);
const tickDown = (value) => round2(Math.floor((Number(value) + 1e-9) / TICK_SIZE) * TICK_SIZE);
const tickNearest = (value) => round2(Math.round(Number(value) / TICK_SIZE) * TICK_SIZE);

function positionReferenceForClub(club) {
  const position = Number(club?.posicao);
  const totalParticipants = Number(club?.metadata?.totalParticipantes || 20);

  if (
    !Number.isInteger(position) ||
    !Number.isInteger(totalParticipants) ||
    position < 1 ||
    position > totalParticipants
  ) {
    return tickNearest(club?.preco ?? club?.precoAtual ?? 0);
  }

  return tickNearest(5 * Math.pow(1.05, totalParticipants - position));
}

function userOrderPriceBand(state, referencePrice) {
  const configured = Number(state?.userOrderBandPct);
  const bandPct = Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_USER_ORDER_BAND_PCT;
  const reference = Number(referencePrice || 0);

  return {
    bandPct,
    min: tickUp(reference * (1 - bandPct)),
    max: tickDown(reference * (1 + bandPct)),
  };
}

function isUserOrderPriceAllowed(price, state, referencePrice) {
  const value = Number(price);
  const band = userOrderPriceBand(state, referencePrice);
  return Number.isFinite(value) && value > 0 && value >= band.min && value <= band.max;
}

function canReachInstitutionAfterUserOrders({
  incomingType,
  incomingPrice,
  incomingQuantity,
  incomingUserId,
  userOrders = [],
}) {
  const price = Number(incomingPrice);
  const quantity = Number(incomingQuantity);
  let totalUserQuantity = 0;

  for (const order of userOrders) {
    const remaining = Number(order?.restante || 0);
    if (remaining <= 0) continue;

    if (String(order?.usuarioId) === String(incomingUserId)) return false;

    const orderPrice = Number(order?.preco);
    const crosses = incomingType === 'compra'
      ? orderPrice <= price
      : orderPrice >= price;

    if (!crosses) return false;
    totalUserQuantity += remaining;
  }

  return quantity >= totalUserQuantity;
}

function pricesFor(state, baseValue) {
  const officialPrice = tickNearest(baseValue);
  return {
    officialPrice,
    primaryAsk: officialPrice,
    resaleAsk: tickUp(officialPrice * (1 + Number(state.sellMarginPct || 0))),
    bid: tickDown(officialPrice * (1 - Number(state.buyDiscountPct || 0))),
  };
}

module.exports = {
  TICK_SIZE,
  DEFAULT_USER_ORDER_BAND_PCT,
  round2,
  tickUp,
  tickDown,
  tickNearest,
  positionReferenceForClub,
  userOrderPriceBand,
  isUserOrderPriceAllowed,
  canReachInstitutionAfterUserOrders,
  pricesFor,
};

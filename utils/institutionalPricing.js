const TICK_SIZE = 0.05;
const round2 = (value) => Number(Number(value || 0).toFixed(2));
const tickUp = (value) => round2(Math.ceil((Number(value) - 1e-9) / TICK_SIZE) * TICK_SIZE);
const tickDown = (value) => round2(Math.floor((Number(value) + 1e-9) / TICK_SIZE) * TICK_SIZE);
const tickNearest = (value) => round2(Math.round(Number(value) / TICK_SIZE) * TICK_SIZE);

function pricesFor(state, baseValue) {
  const officialPrice = tickNearest(baseValue);
  return {
    officialPrice,
    primaryAsk: officialPrice,
    resaleAsk: tickUp(officialPrice * (1 + Number(state.sellMarginPct || 0))),
    bid: tickDown(officialPrice * (1 - Number(state.buyDiscountPct || 0))),
  };
}

module.exports = { TICK_SIZE, round2, tickUp, tickDown, tickNearest, pricesFor };

const MODES = Object.freeze({
  IPO: 'IPO',
  UNIFIED_LIQUIDITY: 'UNIFIED_LIQUIDITY',
});

function normalizeMode(value) {
  const mode = String(value || '').trim().toUpperCase();
  return Object.values(MODES).includes(mode) ? mode : MODES.UNIFIED_LIQUIDITY;
}

function getMarketMode() {
  return normalizeMode(process.env.MARKET_MODE);
}

function isUnifiedLiquidity() {
  return getMarketMode() === MODES.UNIFIED_LIQUIDITY;
}

module.exports = { MODES, getMarketMode, isUnifiedLiquidity };

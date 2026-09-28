const MarketControl = require('../models/MarketControl');

function mercadoDoClube(clube) {
  return String(
    clube?.metadata?.ligaId ||
    clube?.ligaId ||
    ''
  ).trim().toLowerCase();
}

async function mercadoFechadoParaClube(clube, session) {
  const ligaId = mercadoDoClube(clube);
  if (!ligaId) return false;
  let query = MarketControl.findOne({ ligaId, fechado: true });
  if (session) query = query.session(session);
  return Boolean(await query.lean());
}

module.exports = { mercadoDoClube, mercadoFechadoParaClube };

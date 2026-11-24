const Club = require('../models/Club');
const Order = require('../models/Order');
const { round2 } = require('./rankingPerformance');

function clubPriceMap(clubs = []) {
  return new Map(
    clubs.map((club) => [
      String(club.legacyId),
      Number(club.precoAtual ?? club.preco ?? 0),
    ])
  );
}

function positionsValue(user, prices) {
  return round2((Array.isArray(user?.carteira) ? user.carteira : []).reduce((sum, asset) => {
    const clubId = asset.clubeId ?? asset.clubeLegacyId ?? asset.idClube ?? asset.clube?.legacyId;
    const quantity = Number(asset.quantidade ?? asset.cotas ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) return sum;
    const marketPrice = prices.get(String(clubId));
    const fallback = Number(asset.precoMedio ?? asset.valorUnitario ?? 0);
    const price = Number.isFinite(marketPrice) ? marketPrice : fallback;
    return sum + quantity * (Number.isFinite(price) ? price : 0);
  }, 0));
}

async function valueUserPortfolio(user, { session = null, includeOrders = false } = {}) {
  const clubQuery = Club.find({}).select('legacyId precoAtual preco').lean();
  if (session) clubQuery.session(session);
  const clubs = await clubQuery;
  const prices = clubPriceMap(clubs);
  const saldo = round2(user?.saldo || 0);
  const valorPosicoes = positionsValue(user, prices);

  let valorBloqueado = 0;
  if (includeOrders && user?._id) {
    const orderQuery = Order.find({
      usuarioId: user._id,
      tipo: 'compra',
      status: { $in: ['aberta', 'parcial'] },
      restante: { $gt: 0 },
      isInstitutional: { $ne: true },
    }).select('preco restante').lean();
    if (session) orderQuery.session(session);
    const orders = await orderQuery;
    valorBloqueado = round2(orders.reduce(
      (sum, order) => sum + Number(order.preco || 0) * Number(order.restante || 0),
      0
    ));
  }

  // O motor atual mantém reservas de compra dentro do saldo. Portanto,
  // saldoLivre + valorBloqueado = saldo e o patrimônio nunca é contado em dobro.
  const saldoLivre = round2(Math.max(0, saldo - valorBloqueado));
  const bloqueadoIncluidoNoSaldo = round2(Math.min(saldo, valorBloqueado));

  return {
    saldo,
    saldoLivre,
    valorBloqueado: bloqueadoIncluidoNoSaldo,
    valorPosicoes,
    patrimonio: round2(saldoLivre + bloqueadoIncluidoNoSaldo + valorPosicoes),
  };
}

module.exports = { clubPriceMap, positionsValue, valueUserPortfolio };

'use strict';

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizeType(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function movementDirection(type) {
  const normalized = normalizeType(type);

  if (
    normalized === 'IPO' ||
    normalized === 'COMPRA' ||
    normalized === 'COMPRA_SECUNDARIO' ||
    normalized.includes('SUBSCRI')
  ) {
    return 'BUY';
  }

  if (
    normalized === 'VENDA' ||
    normalized === 'IPO_RETURN' ||
    normalized === 'DEVOLUCAO_IPO' ||
    normalized.startsWith('LIQUIDA')
  ) {
    return 'SELL';
  }

  return null;
}

function resolveLegacyClubId(movement, clubLegacyIdByMongoId = new Map()) {
  const direct = Number(
    movement?.clubeLegacyId ??
      movement?.clubeId?.legacyId ??
      movement?.clube?.legacyId ??
      movement?.clube?.id,
  );

  if (Number.isFinite(direct) && direct > 0) return direct;

  const mongoId = movement?.clubeId?._id ?? movement?.clubeId;
  if (mongoId == null) return null;

  const mapped = Number(clubLegacyIdByMongoId.get(String(mongoId)));
  return Number.isFinite(mapped) && mapped > 0 ? mapped : null;
}

function projectPortfolioFromMovements(movements, options = {}) {
  const clubLegacyIdByMongoId = options.clubLegacyIdByMongoId || new Map();
  const positions = new Map();

  for (const movement of Array.isArray(movements) ? movements : []) {
    const direction = movementDirection(movement?.tipo);
    if (!direction) continue;

    const clubId = resolveLegacyClubId(movement, clubLegacyIdByMongoId);
    const quantity = Number(movement?.quantidade || 0);

    if (!clubId || !Number.isFinite(quantity) || quantity <= 0) continue;

    const key = String(clubId);
    const current = positions.get(key) || {
      clubeId: clubId,
      nomeClube: String(movement?.clubeNome || ''),
      quantidade: 0,
      precoMedio: 0,
      totalInvestido: 0,
    };

    if (direction === 'BUY') {
      const unitPrice = Number(
        movement?.precoUnitario ?? movement?.valorUnitario ?? 0,
      );
      if (!Number.isFinite(unitPrice) || unitPrice < 0) continue;

      // Taxas afetam o saldo, mas não o preço médio do ativo.
      const acquisitionCost = round2(quantity * unitPrice);
      const newQuantity = Number(current.quantidade || 0) + quantity;
      const newTotal = round2(
        Number(current.totalInvestido || 0) + acquisitionCost,
      );

      positions.set(key, {
        clubeId: clubId,
        nomeClube: current.nomeClube || String(movement?.clubeNome || ''),
        quantidade: newQuantity,
        precoMedio: newQuantity > 0 ? round2(newTotal / newQuantity) : 0,
        totalInvestido: newTotal,
      });
      continue;
    }

    const remaining = Math.max(0, Number(current.quantidade || 0) - quantity);
    if (remaining <= 0) {
      positions.delete(key);
      continue;
    }

    const averagePrice = round2(current.precoMedio || 0);
    positions.set(key, {
      ...current,
      quantidade: remaining,
      precoMedio: averagePrice,
      totalInvestido: round2(remaining * averagePrice),
    });
  }

  return Array.from(positions.values())
    .filter((position) => Number(position.quantidade || 0) > 0)
    .sort((a, b) => Number(a.clubeId) - Number(b.clubeId));
}

function normalizeStoredPortfolio(portfolio) {
  return (Array.isArray(portfolio) ? portfolio : [])
    .map((position) => ({
      clubeId: Number(position?.clubeId),
      nomeClube: String(position?.nomeClube || position?.nome || ''),
      quantidade: Number(position?.quantidade || 0),
      precoMedio: round2(position?.precoMedio || 0),
      totalInvestido: round2(position?.totalInvestido || 0),
    }))
    .filter(
      (position) =>
        Number.isFinite(position.clubeId) &&
        position.clubeId > 0 &&
        Number.isFinite(position.quantidade) &&
        position.quantidade > 0,
    )
    .sort((a, b) => a.clubeId - b.clubeId);
}

function portfoliosEqual(left, right) {
  return (
    JSON.stringify(normalizeStoredPortfolio(left)) ===
    JSON.stringify(normalizeStoredPortfolio(right))
  );
}

module.exports = {
  movementDirection,
  normalizeStoredPortfolio,
  portfoliosEqual,
  projectPortfolioFromMovements,
  resolveLegacyClubId,
};

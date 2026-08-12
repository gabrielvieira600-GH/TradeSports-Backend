function text(value) {
  return String(value || '').trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toCachedTableItem(club) {
  const stats = club?.metadata?.classificacao || {};

  return {
    id: club.legacyId,
    legacyId: club.legacyId,
    nome: text(club.nome),
    escudo: text(club.escudo),
    posicao: number(club.posicao),
    pontos: number(stats.pontos),
    jogos: number(stats.jogos),
    vitorias: number(stats.vitorias),
    empates: number(stats.empates),
    derrotas: number(stats.derrotas),
    saldo: number(stats.saldo ?? stats.saldoGols),
    saldoGols: number(stats.saldoGols ?? stats.saldo),
    grupo: text(stats.grupo),
    preco: number(club.preco),
    precoAtual: club.precoAtual == null
      ? number(club.preco)
      : number(club.precoAtual),
    cotasDisponiveis: number(club.cotasDisponiveis),
    cotasEmitidas: number(club.cotasEmitidas),
    ipoEncerrado: Boolean(club.ipoEncerrado),
  };
}

function marketFilter(marketId) {
  if (marketId === 'brasileirao-a') {
    return {
      $or: [
        { 'metadata.ligaId': 'brasileirao-a' },
        { 'metadata.campeonato': 'Brasileirao' },
        {
          $and: [
            { 'metadata.ligaId': { $exists: false } },
            { legacyId: { $gt: 0, $lt: 1000000 } },
          ],
        },
      ],
    };
  }

  return { 'metadata.ligaId': marketId };
}

async function loadCachedTable(ClubModel, marketId) {
  const clubs = await ClubModel.find(marketFilter(marketId))
    .sort({ posicao: 1, nome: 1 })
    .lean();

  const table = clubs
    .map(toCachedTableItem)
    .filter((club) => club.id && club.nome)
    .sort((a, b) => {
      const positionA = a.posicao > 0 ? a.posicao : Number.MAX_SAFE_INTEGER;
      const positionB = b.posicao > 0 ? b.posicao : Number.MAX_SAFE_INTEGER;
      return positionA - positionB || a.nome.localeCompare(b.nome);
    });

  return table.map((club) => ({
    ...club,
    posicao: club.posicao > 0 ? club.posicao : table.length,
  }));
}

module.exports = {
  loadCachedTable,
  marketFilter,
  toCachedTableItem,
};

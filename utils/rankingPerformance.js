const DEFAULT_CAPITAL = 1000;

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function round6(value) {
  return Math.round((Number(value) || 0) * 1_000_000) / 1_000_000;
}

function seasonKey(season) {
  return String(season?.codigo || season?._id || season || 'global');
}

function basePatrimony(user) {
  const value = Number(
    user?.patrimonioInicialTemporada ?? user?.capitalInicial ?? DEFAULT_CAPITAL
  );
  return Number.isFinite(value) && value > 0 ? round2(value) : DEFAULT_CAPITAL;
}

function normalizedState(user, season) {
  const stored = user?.rankingPerformance || {};
  const requestedKey = seasonKey(season || user?.temporadaRanking || stored.temporadaChave || 'global');
  const key = requestedKey === 'global' && stored.temporadaChave
    ? String(stored.temporadaChave)
    : requestedKey;
  const sameSeason = String(stored.temporadaChave || '') === key;

  if (!sameSeason) {
    return {
      versao: 1,
      temporadaChave: key,
      fatorFechado: 1,
      patrimonioReferencia: basePatrimony(user),
      aportesExternosTotal: 0,
      ultimaMovimentacaoExternaEm: null,
    };
  }

  const factor = Number(stored.fatorFechado);
  const reference = Number(stored.patrimonioReferencia);
  const contributions = Number(stored.aportesExternosTotal);

  return {
    versao: 1,
    temporadaChave: key,
    fatorFechado: Number.isFinite(factor) && factor >= 0 ? factor : 1,
    patrimonioReferencia:
      Number.isFinite(reference) && reference > 0 ? reference : basePatrimony(user),
    aportesExternosTotal:
      Number.isFinite(contributions) && contributions >= 0 ? round2(contributions) : 0,
    ultimaMovimentacaoExternaEm: stored.ultimaMovimentacaoExternaEm || null,
  };
}

function performanceForPatrimony(user, patrimony, season) {
  const state = normalizedState(user, season);
  const current = Math.max(0, Number(patrimony) || 0);
  const factor = state.patrimonioReferencia > 0
    ? state.fatorFechado * (current / state.patrimonioReferencia)
    : state.fatorFechado;
  const initial = basePatrimony(user);

  return {
    fatorPerformance: round6(factor),
    rentabilidade: round2((factor - 1) * 100),
    resultado: round2(current - initial - state.aportesExternosTotal),
    aportesExternosTotal: round2(state.aportesExternosTotal),
    patrimonioInicial: initial,
    estado: state,
  };
}

function stateAfterContribution({ user, patrimonyBefore, amount, season, at = new Date() }) {
  const contribution = round2(amount);
  const before = round2(patrimonyBefore);

  if (!Number.isFinite(contribution) || contribution <= 0) {
    throw new Error('Aporte externo inválido.');
  }

  const state = normalizedState(user, season);
  const closedFactor = state.patrimonioReferencia > 0
    ? state.fatorFechado * (Math.max(0, before) / state.patrimonioReferencia)
    : state.fatorFechado;

  return {
    versao: 1,
    temporadaChave: state.temporadaChave,
    fatorFechado: round6(closedFactor),
    patrimonioReferencia: round2(before + contribution),
    aportesExternosTotal: round2(state.aportesExternosTotal + contribution),
    ultimaMovimentacaoExternaEm: at,
  };
}

module.exports = {
  DEFAULT_CAPITAL,
  basePatrimony,
  normalizedState,
  performanceForPatrimony,
  round2,
  seasonKey,
  stateAfterContribution,
};

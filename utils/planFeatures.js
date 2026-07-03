const PLANOS = Object.freeze({
  LITE: 'lite',
  PREMIUM: 'premium',
});

const FEATURES = Object.freeze({
  ORDENS_ILIMITADAS: 'ordens_ilimitadas',

  CRIAR_RANKING_PRIVADO:
    'criar_ranking_privado',

  PARTICIPAR_RANKING_PRIVADO:
    'participar_ranking_privado',

  HISTORICO_COMPLETO:
    'historico_completo',

  WATCHLIST_ILIMITADA:
    'watchlist_ilimitada',

  ALERTAS_PERSONALIZADOS:
    'alertas_personalizados',

  ANALYTICS_AVANCADO:
    'analytics_avancado',

  EXPORTACAO:
    'exportacao',

  COMPARACAO_CLUBES:
    'comparacao_clubes',

  RANKING_AVANCADO:
    'ranking_avancado',

  RELATORIOS_PREMIUM:
    'relatorios_premium',

  PERFIL_PERSONALIZADO:
    'perfil_personalizado',
});

const LIMITES = Object.freeze({
  [PLANOS.LITE]: {
    ordensPorRodada: 15,
    clubesWatchlist: 5,
    ligasWatchlist: 2,
    diasHistorico: 30,
    rankingsPrivadosCriados: 0,
    rankingsPrivadosParticipando: 0,
  },

  [PLANOS.PREMIUM]: {
    ordensPorRodada: null,
    clubesWatchlist: null,
    ligasWatchlist: null,
    diasHistorico: null,
    rankingsPrivadosCriados: 5,
    rankingsPrivadosParticipando: 20,
  },
});

const FEATURES_POR_PLANO = Object.freeze({
  [PLANOS.LITE]: new Set([]),

  [PLANOS.PREMIUM]: new Set([
    FEATURES.ORDENS_ILIMITADAS,
    FEATURES.CRIAR_RANKING_PRIVADO,
    FEATURES.PARTICIPAR_RANKING_PRIVADO,
    FEATURES.HISTORICO_COMPLETO,
    FEATURES.WATCHLIST_ILIMITADA,
    FEATURES.ALERTAS_PERSONALIZADOS,
    FEATURES.ANALYTICS_AVANCADO,
    FEATURES.EXPORTACAO,
    FEATURES.COMPARACAO_CLUBES,
    FEATURES.RANKING_AVANCADO,
    FEATURES.RELATORIOS_PREMIUM,
    FEATURES.PERFIL_PERSONALIZADO,
  ]),
});

function dataValida(valor) {
  if (!valor) return null;

  const data = new Date(valor);

  return Number.isNaN(data.getTime())
    ? null
    : data;
}

function premiumEstaAtivo(usuario, agora = new Date()) {
  if (!usuario) return false;

  if (usuario.plano !== PLANOS.PREMIUM) {
    return false;
  }

  if (usuario.premiumAtivo !== true) {
    return false;
  }

  const inicio = dataValida(
    usuario.premiumInicio
  );

  const fim = dataValida(
    usuario.premiumFim
  );

  if (inicio && agora < inicio) {
    return false;
  }

  if (fim && agora >= fim) {
    return false;
  }

  return true;
}

function obterPlanoEfetivo(usuario, agora = new Date()) {
  return premiumEstaAtivo(usuario, agora)
    ? PLANOS.PREMIUM
    : PLANOS.LITE;
}

function temAcesso(usuario, feature, agora = new Date()) {
  const plano = obterPlanoEfetivo(
    usuario,
    agora
  );

  return Boolean(
    FEATURES_POR_PLANO[plano]?.has(feature)
  );
}

function obterLimitesDoPlano(
  usuario,
  agora = new Date()
) {
  const plano = obterPlanoEfetivo(
    usuario,
    agora
  );

  return {
    ...LIMITES[plano],
  };
}

function obterResumoDoPlano(
  usuario,
  agora = new Date()
) {
  const planoEfetivo = obterPlanoEfetivo(
    usuario,
    agora
  );

  const premiumAtivo =
    planoEfetivo === PLANOS.PREMIUM;

  const featuresDisponiveis = Object.values(
    FEATURES
  ).reduce((resultado, feature) => {
    resultado[feature] = temAcesso(
      usuario,
      feature,
      agora
    );

    return resultado;
  }, {});

  return {
    planoCadastrado:
      usuario?.plano || PLANOS.LITE,

    plano: planoEfetivo,
    premiumAtivo,

    premiumInicio:
      usuario?.premiumInicio || null,

    premiumFim:
      usuario?.premiumFim || null,

    limites: obterLimitesDoPlano(
      usuario,
      agora
    ),

    features: featuresDisponiveis,
  };
}

module.exports = {
  PLANOS,
  FEATURES,
  LIMITES,
  premiumEstaAtivo,
  obterPlanoEfetivo,
  temAcesso,
  obterLimitesDoPlano,
  obterResumoDoPlano,
};
const UserTradingQuota = require('../models/UserTradingQuota');
const Order = require('../models/Order');

const TIMEZONE_TRADESPORTS = 'America/Sao_Paulo';
const LIMITE_SEMANAL_LITE_PADRAO = 15;

const REWARDED_AD_ORDENS_POR_RECOMPENSA = 2;
const REWARDED_AD_MAXIMO_SEMANAL = 5;
const REWARDED_AD_BONUS_MAXIMO_SEMANAL =
  REWARDED_AD_ORDENS_POR_RECOMPENSA * REWARDED_AD_MAXIMO_SEMANAL;

function pad2(valor) {
  return String(valor).padStart(2, '0');
}

function obterPartesDataBrasilia(data = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE_TRADESPORTS,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const partes = formatter.formatToParts(data);
  const mapa = {};

  for (const parte of partes) {
    if (parte.type !== 'literal') {
      mapa[parte.type] = parte.value;
    }
  }

  return {
    ano: Number(mapa.year),
    mes: Number(mapa.month),
    dia: Number(mapa.day),
  };
}

function criarDataBrasiliaInicioDoDia({ ano, mes, dia }) {
  return new Date(
    `${ano}-${pad2(mes)}-${pad2(dia)}T00:00:00.000-03:00`
  );
}

function adicionarDiasCalendario({ ano, mes, dia }, quantidade) {
  const dataUtc = new Date(Date.UTC(ano, mes - 1, dia));
  dataUtc.setUTCDate(dataUtc.getUTCDate() + quantidade);

  return {
    ano: dataUtc.getUTCFullYear(),
    mes: dataUtc.getUTCMonth() + 1,
    dia: dataUtc.getUTCDate(),
  };
}

function obterDiaSemana({ ano, mes, dia }) {
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

function gerarChavePeriodo(inicioLocal) {
  return [
    inicioLocal.ano,
    pad2(inicioLocal.mes),
    pad2(inicioLocal.dia),
  ].join('-');
}

function obterJanelaSemanal(dataReferencia = new Date()) {
  const hojeLocal = obterPartesDataBrasilia(dataReferencia);
  const diaSemana = obterDiaSemana(hojeLocal);

  // domingo = 0; segunda = 1. A semana TradeSports começa na segunda-feira.
  const diasDesdeSegunda = diaSemana === 0 ? 6 : diaSemana - 1;

  const inicioLocal = adicionarDiasCalendario(
    hojeLocal,
    -diasDesdeSegunda
  );

  const proximaSegundaLocal = adicionarDiasCalendario(
    inicioLocal,
    7
  );

  const periodoInicio = criarDataBrasiliaInicioDoDia(inicioLocal);
  const periodoFim = criarDataBrasiliaInicioDoDia(proximaSegundaLocal);

  return {
    periodoTipo: 'semanal',
    periodoChave: gerarChavePeriodo(inicioLocal),
    periodoInicio,
    periodoFim,
    renovaEm: periodoFim,
    timezone: TIMEZONE_TRADESPORTS,
  };
}

function numeroNaoNegativo(valor, padrao = 0) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(0, numero);
}

function obterResumoRewardedQuota(
  quota,
  limiteLite = LIMITE_SEMANAL_LITE_PADRAO
) {
  const limitePadrao = Math.max(
    1,
    Number(limiteLite || LIMITE_SEMANAL_LITE_PADRAO)
  );

  const bonusRegistrado = Math.min(
    REWARDED_AD_BONUS_MAXIMO_SEMANAL,
    numeroNaoNegativo(quota?.bonusOrdens)
  );

  const limiteAtual = Math.max(
    1,
    Number(quota?.limiteOrdens || limitePadrao)
  );

  const baseRegistrada = Number(quota?.limiteBaseOrdens);

  const limiteBase =
    Number.isFinite(baseRegistrada) && baseRegistrada > 0
      ? baseRegistrada
      : Math.max(1, limiteAtual - bonusRegistrado);

  const concluidosRegistrados = Number(quota?.rewardedAdsConcluidos);
  const concluidosInferidos = Math.floor(
    bonusRegistrado / REWARDED_AD_ORDENS_POR_RECOMPENSA
  );

  const concluidos = Math.min(
    REWARDED_AD_MAXIMO_SEMANAL,
    Math.max(
      0,
      Number.isFinite(concluidosRegistrados) ? concluidosRegistrados : 0,
      concluidosInferidos
    )
  );

  // O histórico de rewarded ads é a referência para o teto do bônus.
  // Se um documento legado estiver inconsistente, nunca elevamos o bônus
  // acima do que a quantidade de recompensas permite.
  const bonusMaximoPelosEventos =
    concluidos * REWARDED_AD_ORDENS_POR_RECOMPENSA;

  const bonusOrdens = Math.min(
    bonusRegistrado,
    bonusMaximoPelosEventos
  );

  const limiteEfetivo = limiteBase + bonusOrdens;
  const restantesRewardedAds = Math.max(
    0,
    REWARDED_AD_MAXIMO_SEMANAL - concluidos
  );

  return {
    limiteBase,
    bonusOrdens,
    limiteEfetivo,
    concluidos,
    maximoSemanal: REWARDED_AD_MAXIMO_SEMANAL,
    restantesRewardedAds,
    ordensPorAnuncio: REWARDED_AD_ORDENS_POR_RECOMPENSA,
    bonusMaximo: REWARDED_AD_BONUS_MAXIMO_SEMANAL,
    disponivel: restantesRewardedAds > 0,
  };
}

function sincronizarCamposRewardedQuota(
  quota,
  limiteLite = LIMITE_SEMANAL_LITE_PADRAO
) {
  const resumo = obterResumoRewardedQuota(quota, limiteLite);

  quota.limiteBaseOrdens = resumo.limiteBase;
  quota.bonusOrdens = resumo.bonusOrdens;
  quota.rewardedAdsConcluidos = resumo.concluidos;
  quota.limiteOrdens = resumo.limiteEfetivo;

  return resumo;
}

function aplicarRecompensaRewardedQuota({
  quota,
  limiteLite = LIMITE_SEMANAL_LITE_PADRAO,
  rewardedAdsConcluidosConfirmados,
  agora = new Date(),
}) {
  const resumoAtual = sincronizarCamposRewardedQuota(quota, limiteLite);

  const concluidosConfirmados = Math.max(
    resumoAtual.concluidos,
    Number(rewardedAdsConcluidosConfirmados || 0)
  );

  if (concluidosConfirmados >= REWARDED_AD_MAXIMO_SEMANAL) {
    const erro = new Error('REWARDED_AD_LIMITE_SEMANAL');
    erro.maximoSemanal = REWARDED_AD_MAXIMO_SEMANAL;
    throw erro;
  }

  const novoTotal = concluidosConfirmados + 1;
  const novoBonus = Math.min(
    REWARDED_AD_BONUS_MAXIMO_SEMANAL,
    novoTotal * REWARDED_AD_ORDENS_POR_RECOMPENSA
  );

  quota.limiteBaseOrdens = resumoAtual.limiteBase;
  quota.rewardedAdsConcluidos = novoTotal;
  quota.bonusOrdens = novoBonus;
  quota.limiteOrdens = resumoAtual.limiteBase + novoBonus;
  quota.ultimoRewardedAdEm = agora;

  if (
    Number(quota.ordensUtilizadas || 0) <
    Number(quota.limiteOrdens)
  ) {
    quota.limiteAtingidoEm = null;
  }

  return obterResumoRewardedQuota(quota, limiteLite);
}

async function obterOuCriarQuotaSemanal({
  usuario,
  temporada,
  session = null,
  limiteLite = LIMITE_SEMANAL_LITE_PADRAO,
}) {
  if (!usuario?._id) {
    throw new Error('USUARIO_QUOTA_INVALIDO');
  }

  if (!temporada?._id) {
    throw new Error('TEMPORADA_QUOTA_INVALIDA');
  }

  const janela = obterJanelaSemanal();

  let consulta = UserTradingQuota.findOne({
    usuarioId: usuario._id,
    temporadaId: temporada._id,
    periodoChave: janela.periodoChave,
  });

  if (session) {
    consulta = consulta.session(session);
  }

  let quota = await consulta;

  if (quota) {
    sincronizarCamposRewardedQuota(quota, limiteLite);

    return {
      quota,
      janela,
      criada: false,
    };
  }

  const agora = new Date();
  const limiteBase = Number(limiteLite || LIMITE_SEMANAL_LITE_PADRAO);

  const [quotaCriada] = await UserTradingQuota.create(
    [
      {
        usuarioId: usuario._id,
        temporadaId: temporada._id,
        periodoTipo: janela.periodoTipo,
        periodoChave: janela.periodoChave,
        periodoInicio: janela.periodoInicio,
        periodoFim: janela.periodoFim,
        timezone: janela.timezone,
        planoNoMomento: 'lite',
        limiteBaseOrdens: limiteBase,
        limiteOrdens: limiteBase,
        bonusOrdens: 0,
        rewardedAdsConcluidos: 0,
        ultimoRewardedAdEm: null,
        ordensUtilizadas: 0,
        primeiraOrdemEm: null,
        ultimaOrdemEm: null,
        limiteAtingidoEm: null,
        metadata: {
          criadaEm: agora,
          origem: 'weekly_trading_quota',
        },
      },
    ],
    { session }
  );

  return {
    quota: quotaCriada,
    janela,
    criada: true,
  };
}

async function consumirOrdemQuotaSemanal({
  usuario,
  temporada,
  session = null,
  limiteLite = LIMITE_SEMANAL_LITE_PADRAO,
}) {
  const { quota, janela } = await obterOuCriarQuotaSemanal({
    usuario,
    temporada,
    session,
    limiteLite,
  });

  const resumoRewarded = sincronizarCamposRewardedQuota(quota, limiteLite);
  const utilizadas = Number(quota.ordensUtilizadas || 0);
  const limite = Number(resumoRewarded.limiteEfetivo);

  if (utilizadas >= limite) {
    const erro = new Error('LIMITE_SEMANAL_ORDENS_ATINGIDO');
    erro.limite = limite;
    erro.utilizadas = utilizadas;
    erro.periodoInicio = janela.periodoInicio;
    erro.periodoFim = janela.periodoFim;
    erro.renovaEm = janela.renovaEm;
    throw erro;
  }

  const agora = new Date();

  quota.planoNoMomento = 'lite';
  quota.limiteOrdens = limite;
  quota.ordensUtilizadas = utilizadas + 1;
  quota.primeiraOrdemEm = quota.primeiraOrdemEm || agora;
  quota.ultimaOrdemEm = agora;

  if (quota.ordensUtilizadas >= limite) {
    quota.limiteAtingidoEm = quota.limiteAtingidoEm || agora;
  }

  await quota.save({ session });

  return {
    quota,
    janela,
    limite,
    utilizadas: Number(quota.ordensUtilizadas),
    restantes: Math.max(0, limite - Number(quota.ordensUtilizadas)),
    limiteAtingido: Number(quota.ordensUtilizadas) >= limite,
    rewardedAds: resumoRewarded,
  };
}

async function reconciliarQuotaComOrdensExecutadas({
  usuario,
  temporada,
  session = null,
  limiteLite,
}) {
  const { quota, janela } = await obterOuCriarQuotaSemanal({
    usuario,
    temporada,
    session,
    limiteLite,
  });

  let consulta = Order.countDocuments({
    usuarioId: usuario._id,
    isInstitutional: { $ne: true },
    criadoEm: { $gte: janela.periodoInicio, $lt: janela.periodoFim },
    $or: [
      { status: { $in: ['executada', 'parcial'] } },
      { $expr: { $lt: ['$restante', '$quantidade'] } },
      {
        'metadata.quotaLiteContabilizada': true,
        'metadata.quotaLitePeriodo': janela.periodoChave,
      },
    ],
  });

  if (session) consulta = consulta.session(session);
  const executadas = await consulta;

  quota.ordensUtilizadas = Math.max(0, Number(executadas || 0));

  const resumoRewarded = sincronizarCamposRewardedQuota(
    quota,
    limiteLite || LIMITE_SEMANAL_LITE_PADRAO
  );

  quota.limiteAtingidoEm =
    quota.ordensUtilizadas >= Number(resumoRewarded.limiteEfetivo)
      ? quota.limiteAtingidoEm || new Date()
      : null;

  await quota.save({ session });

  return {
    quota,
    janela,
    executadas: quota.ordensUtilizadas,
    rewardedAds: resumoRewarded,
  };
}

module.exports = {
  TIMEZONE_TRADESPORTS,
  LIMITE_SEMANAL_LITE_PADRAO,
  REWARDED_AD_ORDENS_POR_RECOMPENSA,
  REWARDED_AD_MAXIMO_SEMANAL,
  REWARDED_AD_BONUS_MAXIMO_SEMANAL,
  obterJanelaSemanal,
  obterResumoRewardedQuota,
  aplicarRecompensaRewardedQuota,
  obterOuCriarQuotaSemanal,
  consumirOrdemQuotaSemanal,
  reconciliarQuotaComOrdensExecutadas,
};

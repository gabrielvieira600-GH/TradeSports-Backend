const UserTradingQuota = require('../models/UserTradingQuota');

const TIMEZONE_TRADESPORTS = 'America/Sao_Paulo';

const LIMITE_SEMANAL_LITE_PADRAO = 15;

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

  /*

   * JavaScript:

   * domingo = 0

   * segunda = 1

   *

   * A semana TradeSports começa na segunda-feira.

   */

  const diasDesdeSegunda =

    diaSemana === 0

      ? 6

      : diaSemana - 1;

  const inicioLocal = adicionarDiasCalendario(

    hojeLocal,

    -diasDesdeSegunda

  );

  const proximaSegundaLocal = adicionarDiasCalendario(

    inicioLocal,

    7

  );

  const periodoInicio =

    criarDataBrasiliaInicioDoDia(inicioLocal);

  const periodoFim =

    criarDataBrasiliaInicioDoDia(proximaSegundaLocal);

  return {

    periodoTipo: 'semanal',

    periodoChave: gerarChavePeriodo(inicioLocal),

    periodoInicio,

    periodoFim,

    renovaEm: periodoFim,

    timezone: TIMEZONE_TRADESPORTS,

  };

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

    return {

      quota,

      janela,

      criada: false,

    };

  }

  const agora = new Date();

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

        limiteOrdens: Number(limiteLite || 15),

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

    {

      session,

    }

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

  const { quota, janela } =

    await obterOuCriarQuotaSemanal({

      usuario,

      temporada,

      session,

      limiteLite,

    });

  const utilizadas = Number(

    quota.ordensUtilizadas || 0

  );

  const limite = Number(

    quota.limiteOrdens || limiteLite || 15

  );

  if (utilizadas >= limite) {

    const erro = new Error(

      'LIMITE_SEMANAL_ORDENS_ATINGIDO'

    );

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

  quota.primeiraOrdemEm =

    quota.primeiraOrdemEm || agora;

  quota.ultimaOrdemEm = agora;

  if (quota.ordensUtilizadas >= limite) {

    quota.limiteAtingidoEm =

      quota.limiteAtingidoEm || agora;

  }

  await quota.save({

    session,

  });

  return {

    quota,

    janela,

    limite,

    utilizadas: Number(quota.ordensUtilizadas),

    restantes: Math.max(

      0,

      limite - Number(quota.ordensUtilizadas)

    ),

    limiteAtingido:

      Number(quota.ordensUtilizadas) >= limite,

  };

}

module.exports = {

  TIMEZONE_TRADESPORTS,

  LIMITE_SEMANAL_LITE_PADRAO,

  obterJanelaSemanal,

  obterOuCriarQuotaSemanal,

  consumirOrdemQuotaSemanal,

};
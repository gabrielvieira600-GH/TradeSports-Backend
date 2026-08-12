const Trophy = require('../models/Trophy');
const TrophyAwardState = require('../models/TrophyAwardState');
const RankingSeason = require('../models/RankingSeason');
const PrivateRanking = require('../models/PrivateRanking');
const PrivateRankingMember = require('../models/PrivateRankingMember');
const User = require('../models/User');
const Club = require('../models/Club');
const { obterPlanoEfetivo } = require('../utils/planFeatures');

const TIME_ZONE = 'America/Sao_Paulo';
const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const MIN_PARTICIPANTES = Math.max(
  1,
  Number.parseInt(process.env.TROPHY_MIN_PARTICIPANTS, 10) || 1
);

function round2(valor) {
  return Number(Number(valor || 0).toFixed(2));
}

function partesDataSaoPaulo(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(data);

  const porTipo = Object.fromEntries(
    partes.filter((item) => item.type !== 'literal').map((item) => [item.type, item.value])
  );

  return {
    ano: Number(porTipo.year),
    mes: Number(porTipo.month),
    dia: Number(porTipo.day),
  };
}

function chaveSemana(data = new Date()) {
  const { ano, mes, dia } = partesDataSaoPaulo(data);
  const dataLocal = new Date(Date.UTC(ano, mes - 1, dia));
  const diaSemana = dataLocal.getUTCDay() || 7;
  dataLocal.setUTCDate(dataLocal.getUTCDate() + 4 - diaSemana);
  const primeiroDia = new Date(Date.UTC(dataLocal.getUTCFullYear(), 0, 1));
  const numero = Math.ceil(((dataLocal - primeiroDia) / 86400000 + 1) / 7);

  return `${dataLocal.getUTCFullYear()}-W${String(numero).padStart(2, '0')}`;
}

function chaveMes(data = new Date()) {
  const { ano, mes } = partesDataSaoPaulo(data);
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

function chavePeriodoAtual(periodoTipo, data = new Date()) {
  if (periodoTipo === 'semana') return chaveSemana(data);
  if (periodoTipo === 'mes') return chaveMes(data);
  throw new Error(`Tipo de período automático inválido: ${periodoTipo}`);
}

function chavePeriodoAnterior(periodoTipo, data = new Date()) {
  const { ano, mes, dia } = partesDataSaoPaulo(data);
  const dataLocal = new Date(Date.UTC(ano, mes - 1, dia, 12));

  if (periodoTipo === 'semana') {
    dataLocal.setUTCDate(dataLocal.getUTCDate() - 7);
    return chaveSemana(dataLocal);
  }

  dataLocal.setUTCDate(1);
  dataLocal.setUTCMonth(dataLocal.getUTCMonth() - 1);
  return chaveMes(dataLocal);
}

function labelPeriodo(periodoTipo, periodoChave, temporada = null) {
  if (periodoTipo === 'semana') {
    const correspondencia = String(periodoChave).match(/^(\d{4})-W(\d{2})$/);
    return correspondencia
      ? `Semana ${Number(correspondencia[2])} de ${correspondencia[1]}`
      : String(periodoChave);
  }

  if (periodoTipo === 'mes') {
    const correspondencia = String(periodoChave).match(/^(\d{4})-(\d{2})$/);
    return correspondencia
      ? `${MESES[Number(correspondencia[2]) - 1] || correspondencia[2]} de ${correspondencia[1]}`
      : String(periodoChave);
  }

  return temporada?.nome || `Temporada ${periodoChave}`;
}

function intervaloPeriodo(periodoTipo, periodoChave) {
  if (periodoTipo === 'mes') {
    const correspondencia = String(periodoChave).match(/^(\d{4})-(\d{2})$/);
    if (!correspondencia) return null;
    const ano = Number(correspondencia[1]);
    const mes = Number(correspondencia[2]);
    const inicio = new Date(`${ano}-${String(mes).padStart(2, '0')}-01T00:00:00-03:00`);
    const proximoAno = mes === 12 ? ano + 1 : ano;
    const proximoMes = mes === 12 ? 1 : mes + 1;
    const fimExclusivo = new Date(
      `${proximoAno}-${String(proximoMes).padStart(2, '0')}-01T00:00:00-03:00`
    );
    return { inicio, fimExclusivo };
  }

  if (periodoTipo === 'semana') {
    const correspondencia = String(periodoChave).match(/^(\d{4})-W(\d{2})$/);
    if (!correspondencia) return null;
    const ano = Number(correspondencia[1]);
    const semana = Number(correspondencia[2]);
    const quatroJaneiro = new Date(Date.UTC(ano, 0, 4, 12));
    const diaSemana = quatroJaneiro.getUTCDay() || 7;
    const segundaSemanaUm = new Date(quatroJaneiro);
    segundaSemanaUm.setUTCDate(quatroJaneiro.getUTCDate() - diaSemana + 1);
    const segunda = new Date(segundaSemanaUm);
    segunda.setUTCDate(segundaSemanaUm.getUTCDate() + (semana - 1) * 7);
    const y = segunda.getUTCFullYear();
    const m = String(segunda.getUTCMonth() + 1).padStart(2, '0');
    const d = String(segunda.getUTCDate()).padStart(2, '0');
    const inicio = new Date(`${y}-${m}-${d}T00:00:00-03:00`);
    return { inicio, fimExclusivo: new Date(inicio.getTime() + 7 * 86400000) };
  }

  return null;
}

function calcularPatrimonio(usuario, precosPorClube) {
  const saldo = Number(usuario.saldo || 0);
  let valorPosicoes = 0;

  for (const ativo of Array.isArray(usuario.carteira) ? usuario.carteira : []) {
    const clubeId = Number(
      ativo.clubeId ??
        ativo.clubeLegacyId ??
        ativo.idClube ??
        ativo.clube?.legacyId ??
        ativo.clube?.id
    );
    const quantidade = Number(ativo.quantidade ?? ativo.cotas ?? 0);

    if (!Number.isFinite(clubeId) || !Number.isFinite(quantidade) || quantidade <= 0) {
      continue;
    }

    const preco =
      precosPorClube.get(String(clubeId)) ??
      Number(ativo.precoMedio ?? ativo.valorUnitario ?? ativo.preco ?? 0);

    valorPosicoes += quantidade * Number(preco || 0);
  }

  const patrimonio = round2(saldo + valorPosicoes);
  const base = Number(
    usuario.patrimonioInicialTemporada || usuario.capitalInicial || 1000
  );
  const resultado = round2(patrimonio - base);
  const rentabilidade = base > 0 ? round2((resultado / base) * 100) : 0;

  return {
    usuarioId: String(usuario._id),
    nome: usuario.nome || '',
    nomeUsuario: usuario.nomeUsuario || '',
    plano: obterPlanoEfetivo(usuario),
    patrimonio,
    resultado,
    rentabilidade,
  };
}

function ordenarPorCriterio(criterio = 'rentabilidade') {
  return (a, b) =>
    Number(b[criterio] || 0) - Number(a[criterio] || 0) ||
    b.rentabilidade - a.rentabilidade ||
    b.resultado - a.resultado ||
    b.patrimonio - a.patrimonio ||
    String(a.nomeUsuario).localeCompare(String(b.nomeUsuario), 'pt-BR');
}

async function carregarBaseRanking() {
  const [usuarios, clubes] = await Promise.all([
    User.find({ rankingAtivo: { $ne: false } })
      .select(
        '_id nome nomeUsuario saldo capitalInicial carteira patrimonioInicialTemporada plano premiumAtivo premiumInicio premiumFim'
      )
      .lean(),
    Club.find({}).select('legacyId precoAtual preco').lean(),
  ]);

  const precosPorClube = new Map(
    clubes.map((clube) => [
      String(clube.legacyId),
      Number(clube.precoAtual ?? clube.preco ?? 0),
    ])
  );

  const todos = usuarios
    .map((usuario) => calcularPatrimonio(usuario, precosPorClube))
    .sort(ordenarPorCriterio('rentabilidade'));

  return {
    todos,
    premium: todos
      .filter((item) => item.plano === 'premium')
      .sort(ordenarPorCriterio('rentabilidade')),
    porUsuarioId: new Map(todos.map((item) => [item.usuarioId, item])),
  };
}

function textosTrofeu({ periodoTipo, categoria, posicao, periodoLabel, rankingNome }) {
  const colocacao = posicao === 1 ? 'Campeão' : posicao === 2 ? 'Vice-campeão' : '3º lugar';
  const periodoAdjetivo =
    periodoTipo === 'semana'
      ? 'semanal'
      : periodoTipo === 'mes'
        ? 'mensal'
        : 'da temporada';
  const categoriaLabel =
    categoria === 'geral'
      ? 'Ranking Geral'
      : categoria === 'premium'
        ? 'Ranking Premium'
        : `Ranking Privado — ${rankingNome}`;

  return {
    titulo: `${colocacao} ${periodoAdjetivo} — ${categoriaLabel}`,
    descricao: `${posicao}º lugar no ${categoriaLabel}, referente a ${periodoLabel}.`,
  };
}

async function concederPodio({
  temporada,
  periodoTipo,
  periodoChave,
  categoria,
  classificacao,
  rankingPrivado = null,
  concedidoEm = new Date(),
}) {
  if (!Array.isArray(classificacao) || classificacao.length < MIN_PARTICIPANTES) {
    return { criados: [], ignorado: 'participantes_insuficientes' };
  }

  const periodoLabel = labelPeriodo(periodoTipo, periodoChave, temporada);
  const criados = [];

  for (let indice = 0; indice < Math.min(3, classificacao.length); indice += 1) {
    const item = classificacao[indice];
    const posicao = indice + 1;
    const rankingId = rankingPrivado?._id ? String(rankingPrivado._id) : 'global';
    const uniqueKey = [
      String(temporada._id),
      periodoTipo,
      periodoChave,
      categoria,
      rankingId,
      posicao,
    ].join(':');
    const textos = textosTrofeu({
      periodoTipo,
      categoria,
      posicao,
      periodoLabel,
      rankingNome: rankingPrivado?.nome || '',
    });

    const resultado = await Trophy.updateOne(
      { uniqueKey },
      {
        $setOnInsert: {
          usuarioId: item.usuarioId,
          temporadaId: temporada._id,
          periodoTipo,
          periodoChave,
          periodoLabel,
          categoria,
          posicao,
          rankingPrivadoId: rankingPrivado?._id || null,
          rankingNome: rankingPrivado?.nome || '',
          titulo: textos.titulo,
          descricao: textos.descricao,
          designKey: `${periodoTipo}-${categoria}-${posicao}`,
          uniqueKey,
          metricas: {
            patrimonio: Number.isFinite(Number(item.patrimonio))
              ? round2(item.patrimonio)
              : null,
            resultado: Number.isFinite(Number(item.resultado))
              ? round2(item.resultado)
              : null,
            rentabilidade: Number.isFinite(Number(item.rentabilidade))
              ? round2(item.rentabilidade)
              : null,
            criterio: rankingPrivado?.criterioClassificacao || 'rentabilidade',
          },
          concedidoEm,
        },
      },
      { upsert: true }
    );

    if (resultado.upsertedCount > 0) {
      criados.push({ usuarioId: item.usuarioId, titulo: textos.titulo, posicao });
    }
  }

  return { criados };
}

async function classificacaoPrivada(ranking, base) {
  if (
    Array.isArray(ranking?.resultadoFinal?.classificacao) &&
    ranking.resultadoFinal.classificacao.length > 0 &&
    ['encerrado', 'arquivado'].includes(ranking.status)
  ) {
    return ranking.resultadoFinal.classificacao.map((item) => ({
      ...item,
      usuarioId: String(item.usuarioId),
    }));
  }

  const membros = await PrivateRankingMember.find({
    rankingId: ranking._id,
    status: 'aprovado',
  })
    .select('usuarioId')
    .lean();
  const classificacao = membros
    .map((membro) => base.porUsuarioId.get(String(membro.usuarioId)))
    .filter(Boolean)
    .sort(ordenarPorCriterio(ranking.criterioClassificacao || 'rentabilidade'));

  return classificacao;
}

async function notificarNovosTrofeus(criados) {
  const porUsuario = new Map();

  for (const item of criados) {
    const lista = porUsuario.get(String(item.usuarioId)) || [];
    lista.push(item);
    porUsuario.set(String(item.usuarioId), lista);
  }

  await Promise.all(
    [...porUsuario.entries()].map(([usuarioId, lista]) => {
      const primeiro = lista[0];
      const body =
        lista.length === 1
          ? primeiro.titulo
          : `Você conquistou ${lista.length} novos troféus. Visite sua Sala de Troféus.`;

      return User.updateOne(
        { _id: usuarioId },
        {
          $push: {
            notificacoes: {
              $each: [
                {
                  id: `trofeu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  title: 'Novo troféu conquistado!',
                  body,
                  read: false,
                  createdAt: new Date(),
                  metadata: {
                    tipo: 'trofeu',
                    targetUrl: `/perfil/${usuarioId}#sala-de-trofeus`,
                    quantidade: lista.length,
                  },
                },
              ],
              $position: 0,
              $slice: 100,
            },
          },
        }
      );
    })
  );
}

async function concederTrofeusPeriodo({
  temporada,
  periodoTipo,
  periodoChave,
  apenasRankingPrivadoId = null,
  incluirGlobais = true,
  concedidoEm = new Date(),
}) {
  if (!temporada?._id) throw new Error('Temporada obrigatória para conceder troféus.');
  if (!['semana', 'mes', 'temporada'].includes(periodoTipo)) {
    throw new Error('Tipo de período de troféu inválido.');
  }

  const base = await carregarBaseRanking();
  const criados = [];
  const detalhes = [];

  if (incluirGlobais) {
    for (const [categoria, classificacao] of [
      ['geral', base.todos],
      ['premium', base.premium],
    ]) {
      const resultado = await concederPodio({
        temporada,
        periodoTipo,
        periodoChave,
        categoria,
        classificacao,
        concedidoEm,
      });
      criados.push(...resultado.criados);
      detalhes.push({ categoria, totalElegiveis: classificacao.length, ...resultado });
    }
  }

  const filtroPrivados = {
    temporadaId: temporada._id,
    status: { $in: ['ativo', 'encerrado', 'arquivado'] },
  };

  if (apenasRankingPrivadoId) filtroPrivados._id = apenasRankingPrivadoId;
  if (periodoTipo !== 'temporada') {
    const intervalo = intervaloPeriodo(periodoTipo, periodoChave);
    if (intervalo) {
      filtroPrivados.dataInicio = { $lt: intervalo.fimExclusivo };
      filtroPrivados.$or = [
        { dataFim: null },
        { dataFim: { $gte: intervalo.inicio } },
      ];
    }
  }

  const rankingsPrivados = await PrivateRanking.find(filtroPrivados).lean();

  for (const ranking of rankingsPrivados) {
    const classificacao = await classificacaoPrivada(ranking, base);
    const resultado = await concederPodio({
      temporada,
      periodoTipo,
      periodoChave,
      categoria: 'privado',
      classificacao,
      rankingPrivado: ranking,
      concedidoEm,
    });
    criados.push(...resultado.criados);
    detalhes.push({
      categoria: 'privado',
      rankingPrivadoId: String(ranking._id),
      rankingNome: ranking.nome,
      totalElegiveis: classificacao.length,
      ...resultado,
    });
  }

  if (criados.length > 0) await notificarNovosTrofeus(criados);

  return {
    ok: true,
    periodoTipo,
    periodoChave,
    novosTrofeus: criados.length,
    detalhes,
  };
}

async function processarEstadoPeriodico(temporada, periodoTipo, agora) {
  const atual = chavePeriodoAtual(periodoTipo, agora);
  let estado = await TrophyAwardState.findOne({
    temporadaId: temporada._id,
    periodoTipo,
  });

  if (!estado) {
    try {
      estado = await TrophyAwardState.create({
        temporadaId: temporada._id,
        periodoTipo,
        periodoAbertoChave: atual,
        ultimaExecucaoEm: agora,
      });
      return { inicializado: true, periodoTipo, periodoAbertoChave: atual };
    } catch (erro) {
      if (erro?.code !== 11000) throw erro;
      estado = await TrophyAwardState.findOne({
        temporadaId: temporada._id,
        periodoTipo,
      });
    }
  }

  if (!estado) {
    throw new Error(`Não foi possível inicializar o fechamento de ${periodoTipo}.`);
  }

  if (!estado.periodoPendenteChave && estado.periodoAbertoChave !== atual) {
    const periodoAbertoAnterior = estado.periodoAbertoChave;
    estado = await TrophyAwardState.findOneAndUpdate(
      {
        _id: estado._id,
        periodoAbertoChave: periodoAbertoAnterior,
        periodoPendenteChave: null,
      },
      {
        $set: {
          periodoPendenteChave: estado.periodoAbertoChave,
          periodoAbertoChave: atual,
          ultimaExecucaoEm: agora,
          ultimoErro: '',
        },
      },
      { new: true }
    );

    if (!estado) {
      estado = await TrophyAwardState.findOne({
        temporadaId: temporada._id,
        periodoTipo,
      });
    }
  }

  if (!estado?.periodoPendenteChave) {
    await TrophyAwardState.updateOne(
      { _id: estado._id },
      { $set: { ultimaExecucaoEm: agora } }
    );
    return { processado: false, periodoTipo, periodoAbertoChave: atual };
  }

  const pendente = estado.periodoPendenteChave;
  const esperado = chavePeriodoAnterior(periodoTipo, agora);

  if (pendente !== esperado) {
    const motivo = `Período ${pendente} não premiado: o último período completo é ${esperado}.`;
    await TrophyAwardState.updateOne(
      { _id: estado._id, periodoPendenteChave: pendente },
      {
        $set: {
          periodoPendenteChave: null,
          ultimaExecucaoEm: agora,
          ultimoErro: motivo,
        },
      }
    );
    return { processado: false, ignorado: true, periodoTipo, motivo };
  }

  try {
    const resultado = await concederTrofeusPeriodo({
      temporada,
      periodoTipo,
      periodoChave: pendente,
      concedidoEm: agora,
    });
    await TrophyAwardState.updateOne(
      { _id: estado._id, periodoPendenteChave: pendente },
      {
        $set: {
          periodoPendenteChave: null,
          ultimoPeriodoConcluido: pendente,
          ultimaExecucaoEm: agora,
          ultimoErro: '',
        },
      }
    );
    return { processado: true, ...resultado };
  } catch (erro) {
    await TrophyAwardState.updateOne(
      { _id: estado._id },
      {
        $set: {
          ultimaExecucaoEm: agora,
          ultimoErro: String(erro?.message || erro).slice(0, 500),
        },
      }
    );
    throw erro;
  }
}

async function processarFechamentosPeriodicos(agora = new Date()) {
  const temporada = await RankingSeason.findOne({ status: 'ativa' }).sort({
    iniciadaEm: -1,
    createdAt: -1,
  });

  if (!temporada) return { ok: true, semTemporadaAtiva: true };

  const resultados = [];
  for (const periodoTipo of ['semana', 'mes']) {
    resultados.push(await processarEstadoPeriodico(temporada, periodoTipo, agora));
  }

  return { ok: true, temporadaId: String(temporada._id), resultados };
}

let intervaloAgendador = null;

function iniciarAgendadorTrofeus() {
  if (intervaloAgendador) return intervaloAgendador;

  const executar = () =>
    processarFechamentosPeriodicos().catch((erro) => {
      console.error('[TROFEUS] Falha no fechamento periódico:', erro);
    });

  executar();
  const intervaloMs = Math.max(
    60 * 1000,
    Number(process.env.TROPHY_SCHEDULER_INTERVAL_MS) || 5 * 60 * 1000
  );
  intervaloAgendador = setInterval(executar, intervaloMs);
  intervaloAgendador.unref?.();
  return intervaloAgendador;
}

module.exports = {
  MIN_PARTICIPANTES,
  chaveSemana,
  chaveMes,
  chavePeriodoAtual,
  chavePeriodoAnterior,
  labelPeriodo,
  intervaloPeriodo,
  concederTrofeusPeriodo,
  processarFechamentosPeriodicos,
  iniciarAgendadorTrofeus,
};

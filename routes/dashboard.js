const express = require('express');

const router = express.Router();

const auth = require('../middleware/auth');

const User = require('../models/User');
const Club = require('../models/Club');
const Order = require('../models/Order');
const Investment = require('../models/Investment');
const RankingSeason = require('../models/RankingSeason');
const RankingRound = require('../models/RankingRound');
const UserTradingQuota = require('../models/UserTradingQuota');

const {
  LIMITE_SEMANAL_LITE_PADRAO,
  obterJanelaSemanal,
} = require('../utils/tradingQuota');

const {
  obterPlanoEfetivo,
} = require('../utils/planFeatures');
const { performanceForPatrimony } = require('../utils/rankingPerformance');

function round2(valor) {
  return Number(Number(valor || 0).toFixed(2));
}

function idClubeDaPosicao(posicao) {
  return Number(
    posicao?.clubeId ??
      posicao?.clubeLegacyId ??
      posicao?.idClube ??
      posicao?.clube?.id ??
      posicao?.clube?.legacyId
  );
}

function quantidadeDaPosicao(posicao) {
  return Number(
    posicao?.quantidade ??
      posicao?.cotas ??
      0
  );
}

function calcularPatrimonioUsuario(
  usuario,
  precosPorClube
) {
  const saldo = round2(usuario?.saldo);
  const carteira = Array.isArray(usuario?.carteira)
    ? usuario.carteira
    : [];

  let valorPosicoes = 0;
  let totalInvestido = 0;
  let quantidadeUnidades = 0;
  let quantidadePosicoes = 0;

  const posicoes = [];

  for (const ativo of carteira) {
    const clubeId = idClubeDaPosicao(ativo);
    const quantidade = quantidadeDaPosicao(ativo);

    if (
      !Number.isFinite(clubeId) ||
      clubeId <= 0 ||
      !Number.isFinite(quantidade) ||
      quantidade <= 0
    ) {
      continue;
    }

    const clube =
      precosPorClube.get(String(clubeId)) ||
      null;

    const precoMedio = Number(
      ativo?.precoMedio ??
        ativo?.valorUnitario ??
        0
    );

    const precoAtualClube = Number(
      clube?.precoAtual ??
        clube?.preco
    );

    const precoAtual = Number.isFinite(
      precoAtualClube
    )
      ? precoAtualClube
      : precoMedio;

    const investidoRaw = Number(
      ativo?.totalInvestido
    );

    const investido = round2(
      Number.isFinite(investidoRaw)
        ? investidoRaw
        : quantidade * precoMedio
    );

    const valorAtual = round2(
      quantidade * precoAtual
    );

    const resultado = round2(
      valorAtual - investido
    );

    const rentabilidade =
      investido > 0
        ? round2(
            (resultado / investido) * 100
          )
        : 0;

    valorPosicoes += valorAtual;
    totalInvestido += investido;
    quantidadeUnidades += quantidade;
    quantidadePosicoes += 1;

    posicoes.push({
      clubeId,
      nome:
        clube?.nome ||
        ativo?.nomeClube ||
        ativo?.clubeNome ||
        'Clube',
      escudo: clube?.escudo || '',
      quantidade: round2(quantidade),
      precoMedio: round2(precoMedio),
      precoAtual: round2(precoAtual),
      totalInvestido: investido,
      valorAtual,
      resultado,
      rentabilidade,
    });
  }

  valorPosicoes = round2(valorPosicoes);
  totalInvestido = round2(totalInvestido);

  const patrimonio = round2(
    saldo + valorPosicoes
  );

  const patrimonioInicialRaw = Number(
    usuario?.patrimonioInicialTemporada
  );

  const temporadaInicializada =
    Boolean(usuario?.temporadaRanking) &&
    Number.isFinite(patrimonioInicialRaw) &&
    patrimonioInicialRaw > 0;

  const patrimonioInicial = round2(
    temporadaInicializada
      ? patrimonioInicialRaw
      : Number(
          usuario?.capitalInicial ?? 1000
        )
  );

  const performance = performanceForPatrimony(
    usuario,
    patrimonio,
    usuario?.temporadaRanking || 'global'
  );
  const resultado = performance.resultado;
  const rentabilidade = performance.rentabilidade;

  return {
    saldo,
    valorPosicoes,
    patrimonio,
    patrimonioInicial,
    resultado,
    rentabilidade,
    aportesExternosTotal: performance.aportesExternosTotal,
    totalInvestido,
    resultadoPosicoes: round2(
      valorPosicoes - totalInvestido
    ),
    quantidadePosicoes,
    quantidadeUnidades: round2(
      quantidadeUnidades
    ),
    temporadaInicializada,
    temporadaRanking:
      usuario?.temporadaRanking || null,
    posicoes: posicoes.sort(
      (a, b) =>
        b.valorAtual - a.valorAtual
    ),
  };
}

function ordenarRanking(a, b) {
  if (
    b.metricas.rentabilidade !==
    a.metricas.rentabilidade
  ) {
    return (
      b.metricas.rentabilidade -
      a.metricas.rentabilidade
    );
  }

  return String(
    a.usuario.nomeUsuario || ''
  ).localeCompare(
    String(
      b.usuario.nomeUsuario || ''
    ),
    'pt-BR'
  );
}

function montarRanking({
  usuarios,
  usuarioAtualId,
  precosPorClube,
}) {
  const base = usuarios
    .map((usuario) => ({
      usuario,
      plano: obterPlanoEfetivo(usuario),
      metricas: calcularPatrimonioUsuario(
        usuario,
        precosPorClube
      ),
    }))
    .sort(ordenarRanking);

  const geral = base.map((item, index) => ({
    ...item,
    posicaoGeral: index + 1,
  }));

  const lite = geral
    .filter((item) => item.plano === 'lite')
    .map((item, index) => ({
      ...item,
      posicaoPlano: index + 1,
    }));

  const premium = geral
    .filter(
      (item) => item.plano === 'premium'
    )
    .map((item, index) => ({
      ...item,
      posicaoPlano: index + 1,
    }));

  const usuarioGeral =
    geral.find(
      (item) =>
        String(item.usuario._id) ===
        String(usuarioAtualId)
    ) || null;

  if (!usuarioGeral) {
    return {
      geral: {
        posicao: null,
        total: geral.length,
      },
      plano: {
        nome: null,
        posicao: null,
        total: 0,
      },
    };
  }

  const rankingPlano =
    usuarioGeral.plano === 'premium'
      ? premium
      : lite;

  const usuarioPlano =
    rankingPlano.find(
      (item) =>
        String(item.usuario._id) ===
        String(usuarioAtualId)
    ) || null;

  return {
    geral: {
      posicao: usuarioGeral.posicaoGeral,
      total: geral.length,
    },
    plano: {
      nome: usuarioGeral.plano,
      posicao:
        usuarioPlano?.posicaoPlano || null,
      total: rankingPlano.length,
    },
  };
}

function criteriosDoUsuario(usuario) {
  const criterios = [
    {
      usuarioId: usuario._id,
    },
  ];

  if (
    usuario.legacyId !== null &&
    usuario.legacyId !== undefined
  ) {
    criterios.push({
      usuarioLegacyId:
        usuario.legacyId,
    });
  }

  return criterios;
}

function normalizarTipoMovimento(tipoOriginal) {
  const tipo = String(
    tipoOriginal || 'OPERACAO'
  )
    .trim()
    .toUpperCase();

  if (
    tipo === 'COMPRA_SECUNDARIO' ||
    tipo.includes('COMPRA')
  ) {
    return 'COMPRA';
  }

  if (tipo === 'DIVIDENDOS') {
    return 'DIVIDENDO';
  }

  if (tipo === 'LIQUIDAÇÃO') {
    return 'LIQUIDACAO';
  }

  return tipo;
}

function formatarMovimento(investment) {
  const tipo = normalizarTipoMovimento(
    investment.tipo
  );

  const quantidade = Number(
    investment.quantidade || 0
  );

  const precoUnitario = Number(
    investment.precoUnitario ??
      investment.valorUnitario ??
      0
  );

  const totalCalculado =
    quantidade > 0
      ? quantidade * precoUnitario
      : precoUnitario;

  const valor = round2(
    investment.totalPago ??
      totalCalculado
  );

  return {
    id: String(investment._id),
    categoria: 'movimento',
    tipo,
    clubeId:
      investment.clubeLegacyId ?? null,
    clubeNome:
      investment.clubeNome || '',
    quantidade: round2(quantidade),
    precoUnitario:
      round2(precoUnitario),
    valor: Math.abs(valor),
    data:
      investment.data ||
      investment.createdAt ||
      null,
  };
}

function formatarOrdem(ordem, clubesPorMongoId) {
  const clube =
    clubesPorMongoId.get(
      String(ordem.clubeId)
    ) || null;

  return {
    id: String(ordem._id),
    categoria: 'ordem',
    tipo:
      String(ordem.tipo).toLowerCase() ===
      'venda'
        ? 'ORDEM_VENDA'
        : 'ORDEM_COMPRA',
    status: ordem.status,
    clubeId:
      ordem.clubeLegacyId ??
      clube?.legacyId ??
      null,
    clubeNome:
      clube?.nome || 'Clube',
    quantidade: round2(
      ordem.quantidade
    ),
    restante: round2(ordem.restante),
    precoUnitario: round2(ordem.preco),
    valor: round2(
      Number(ordem.preco || 0) *
        Number(
          ordem.restante ??
            ordem.quantidade ??
            0
        )
    ),
    data:
      ordem.criadoEm ||
      ordem.createdAt ||
      null,
  };
}

router.get('/', auth, async (req, res) => {
  try {
    const usuario = await User.findById(
      req.usuario.id
    )
      .select(
        [
          '_id',
          'legacyId',
          'nome',
          'sobrenome',
          'nomeUsuario',
          'saldo',
          'capitalInicial',
          'carteira',
          'temporadaRanking',
          'patrimonioInicialTemporada',
          'saldoInicialTemporada',
          'inicioTemporadaRanking',
          'rankingPerformance',
          'rankingAtivo',
          'plano',
          'premiumAtivo',
          'premiumInicio',
          'premiumFim',
          'createdAt',
        ].join(' ')
      )
      .lean();

    if (!usuario) {
      return res.status(404).json({
        erro: 'Usuário não encontrado.',
      });
    }

    const criteriosUsuario =
      criteriosDoUsuario(usuario);

    const [
      clubes,
      temporada,
      ordensAbertas,
      ordensRecentes,
      movimentosRecentes,
      usuariosRanking,
    ] = await Promise.all([
      Club.find({})
        .select(
          '_id legacyId nome escudo preco precoAtual'
        )
        .lean(),

      RankingSeason.findOne({
        status: 'ativa',
      })
        .sort({
          iniciadaEm: -1,
          createdAt: -1,
        })
        .lean(),

      Order.find({
        usuarioId: usuario._id,
        status: {
          $in: ['aberta', 'parcial'],
        },
      })
        .sort({ criadoEm: -1 })
        .lean(),

      Order.find({
        usuarioId: usuario._id,
      })
        .sort({ criadoEm: -1 })
        .limit(6)
        .lean(),

      Investment.find({
        $or: criteriosUsuario,
      })
        .sort({
          data: -1,
          createdAt: -1,
        })
        .limit(8)
        .lean(),

      User.find({
        rankingAtivo: {
          $ne: false,
        },
      })
        .select(
          [
            '_id',
            'nomeUsuario',
            'saldo',
            'capitalInicial',
            'carteira',
            'temporadaRanking',
            'patrimonioInicialTemporada',
            'rankingPerformance',
            'plano',
            'premiumAtivo',
            'premiumInicio',
            'premiumFim',
          ].join(' ')
        )
        .lean(),
    ]);

    const precosPorClube = new Map(
      clubes.map((clube) => [
        String(clube.legacyId),
        clube,
      ])
    );

    const clubesPorMongoId = new Map(
      clubes.map((clube) => [
        String(clube._id),
        clube,
      ])
    );

    const metricas =
      calcularPatrimonioUsuario(
        usuario,
        precosPorClube
      );

    const ranking = montarRanking({
      usuarios: usuariosRanking,
      usuarioAtualId: usuario._id,
      precosPorClube,
    });

    const plano =
      obterPlanoEfetivo(usuario);

    const janela =
      obterJanelaSemanal();

    let rodada = null;
    let quota = null;

    if (temporada) {
      [rodada, quota] = await Promise.all([
        RankingRound.findOne({
          temporadaId: temporada._id,
          status: 'aberta',
        })
          .sort({ numero: -1 })
          .lean(),

        plano === 'lite'
          ? UserTradingQuota.findOne({
              usuarioId: usuario._id,
              temporadaId:
                temporada._id,
              periodoChave:
                janela.periodoChave,
            }).lean()
          : Promise.resolve(null),
      ]);
    }

    const limite =
      plano === 'premium'
        ? null
        : Math.max(
            1,
            Number(
              quota?.limiteOrdens ??
                temporada
                  ?.limiteOrdensLiteSemanal ??
                temporada
                  ?.limiteOrdensLitePorRodada ??
                LIMITE_SEMANAL_LITE_PADRAO
            )
          );

    const utilizadas =
      plano === 'premium'
        ? null
        : Math.max(
            0,
            Number(
              quota?.ordensUtilizadas || 0
            )
          );

    const restantes =
      plano === 'premium'
        ? null
        : Math.max(
            0,
            limite - utilizadas
          );

    const mercadoAberto =
      Boolean(temporada) &&
      temporada.mercadoAberto !== false;

    const resumoOrdensAbertas =
      ordensAbertas.reduce(
        (acc, ordem) => {
          const tipo =
            String(
              ordem.tipo || ''
            ).toLowerCase();

          const restante = Number(
            ordem.restante || 0
          );

          const valor = round2(
            restante *
              Number(ordem.preco || 0)
          );

          acc.total += 1;
          acc.quantidadeRestante +=
            restante;
          acc.valorEmAberto += valor;

          if (tipo === 'venda') {
            acc.venda += 1;
          } else {
            acc.compra += 1;
          }

          return acc;
        },
        {
          total: 0,
          compra: 0,
          venda: 0,
          quantidadeRestante: 0,
          valorEmAberto: 0,
        }
      );

    resumoOrdensAbertas.quantidadeRestante =
      round2(
        resumoOrdensAbertas.quantidadeRestante
      );

    resumoOrdensAbertas.valorEmAberto =
      round2(
        resumoOrdensAbertas.valorEmAberto
      );

    const atividades = [
      ...movimentosRecentes.map(
        formatarMovimento
      ),
      ...ordensRecentes.map((ordem) =>
        formatarOrdem(
          ordem,
          clubesPorMongoId
        )
      ),
    ]
      .sort(
        (a, b) =>
          new Date(b.data || 0) -
          new Date(a.data || 0)
      )
      .slice(0, 6);

    return res.json({
      moeda: 'T$',
      ambiente: 'simulado',
      geradoEm: new Date().toISOString(),

      usuario: {
        id: String(usuario._id),
        nome: usuario.nome || '',
        sobrenome:
          usuario.sobrenome || '',
        nomeUsuario:
          usuario.nomeUsuario || '',
        plano,
      },

      mercado: {
        temporadaAtiva:
          Boolean(temporada),
        mercadoAberto,
        status: !temporada
          ? 'sem_temporada'
          : mercadoAberto
            ? 'aberto'
            : 'fechado',

        temporada: temporada
          ? {
              id: String(
                temporada._id
              ),
              codigo:
                temporada.codigo,
              nome: temporada.nome,
              descricao:
                temporada.descricao ||
                '',
              rodadaAtual:
                temporada.rodadaAtual ??
                null,
              inicio:
                temporada.iniciadaEm ||
                temporada.inicioPrevisto ||
                null,
              fim:
                temporada.encerradaEm ||
                temporada.fimPrevisto ||
                null,
            }
          : null,

        rodadaAberta:
          Boolean(rodada),

        rodada: rodada
          ? {
              id: String(rodada._id),
              numero: rodada.numero,
              nome: rodada.nome || '',
              abertaEm:
                rodada.abertaEm || null,
              fimPrevisto:
                rodada.fimPrevisto ||
                null,
            }
          : null,
      },

      patrimonio: {
        saldo: metricas.saldo,
        valorPosicoes:
          metricas.valorPosicoes,
        patrimonio:
          metricas.patrimonio,
        patrimonioInicial:
          metricas.patrimonioInicial,
        resultado:
          metricas.resultado,
        rentabilidade:
          metricas.rentabilidade,
        totalInvestido:
          metricas.totalInvestido,
        resultadoPosicoes:
          metricas.resultadoPosicoes,
      },

      ranking,

      carteira: {
        quantidadePosicoes:
          metricas.quantidadePosicoes,
        quantidadeUnidades:
          metricas.quantidadeUnidades,
        principaisPosicoes:
          metricas.posicoes.slice(0, 4),
      },

      ordens: {
        abertas:
          resumoOrdensAbertas,

        quota: {
          plano,
          ilimitadas:
            plano === 'premium',
          limite,
          utilizadas,
          restantes,
          limiteAtingido:
            plano === 'lite' &&
            restantes <= 0,
          periodo: {
            tipo: janela.periodoTipo,
            inicio:
              janela.periodoInicio,
            fim: janela.periodoFim,
            renovaEm:
              janela.renovaEm,
            timezone:
              janela.timezone,
          },
        },
      },

      atividadesRecentes: atividades,
    });
  } catch (err) {
    console.error(
      'Erro ao montar dashboard do usuário:',
      err
    );

    return res.status(500).json({
      erro:
        'Não foi possível carregar o dashboard.',
      codigo: 'ERRO_DASHBOARD',
    });
  }
});

module.exports = router;

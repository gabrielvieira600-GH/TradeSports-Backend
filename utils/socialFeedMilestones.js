const User = require('../models/User');
const Club = require('../models/Club');
const SocialFeedEvent = require('../models/SocialFeedEvent');

const RENTABILIDADE_MILESTONES = [5, 10, 25, 50, 100, 200, 500];

function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}

function calcularPatrimonioUsuario(usuario, precosPorClube) {
  const saldo = Number(usuario.saldo || 0);

  const carteira = Array.isArray(usuario.carteira)
    ? usuario.carteira
    : [];

  let valorPosicoes = 0;

  for (const ativo of carteira) {
    const clubeId = Number(
      ativo.clubeId ??
        ativo.clubeLegacyId ??
        ativo.idClube ??
        ativo.clube?.id ??
        ativo.clube?.legacyId
    );

    const quantidade = Number(
      ativo.quantidade ??
        ativo.cotas ??
        0
    );

    if (
      !Number.isFinite(clubeId) ||
      clubeId <= 0 ||
      !Number.isFinite(quantidade) ||
      quantidade <= 0
    ) {
      continue;
    }

    const precoAtualDoClube = precosPorClube.get(String(clubeId));

    const precoAtual = Number.isFinite(precoAtualDoClube)
      ? precoAtualDoClube
      : Number(
          ativo.precoMedio ??
            ativo.valorUnitario ??
            0
        );

    valorPosicoes += quantidade * precoAtual;
  }

  return round2(saldo + valorPosicoes);
}

async function criarEventoMilestoneRentabilidade({
  usuario,
  rentabilidade,
  milestone,
  patrimonio,
  patrimonioInicial,
  origem = '',
}) {
  const nomeUsuario =
    usuario.nomeUsuario ||
    usuario.nome ||
    'Um usuário';

  return SocialFeedEvent.create({
    tipo: 'MILESTONE_RENTABILITY',
    usuarioId: usuario._id,
    titulo: `@${nomeUsuario} atingiu +${milestone}% de rentabilidade`,
    mensagem: `Alcançou ${round2(rentabilidade).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}% de rentabilidade na temporada.`,
    targetUrl: `/perfil/${usuario._id}`,
    visibilidade: 'publico',
    status: 'ativo',
    relevancia: milestone >= 50 ? 5 : milestone >= 25 ? 4 : 3,
    metadata: {
      origem,
      milestone,
      rentabilidade: round2(rentabilidade),
      patrimonio: round2(patrimonio),
      patrimonioInicial: round2(patrimonioInicial),
    },
  });
}

async function verificarMilestoneRentabilidadeUsuario(
  usuarioId,
  { origem = '' } = {}
) {
  try {
    const usuario = await User.findById(usuarioId)
      .select(
        [
          '_id',
          'nome',
          'nomeUsuario',
          'saldo',
          'capitalInicial',
          'carteira',
          'temporadaRanking',
          'patrimonioInicialTemporada',
          'rankingAtivo',
        ].join(' ')
      )
      .lean();

    if (!usuario || usuario.rankingAtivo === false) {
      return null;
    }

    const clubes = await Club.find({})
      .select('legacyId precoAtual preco')
      .lean();

    const precosPorClube = new Map(
      clubes.map((clube) => [
        String(clube.legacyId),
        Number(clube.precoAtual ?? clube.preco ?? 0),
      ])
    );

    const patrimonio = calcularPatrimonioUsuario(
      usuario,
      precosPorClube
    );

    const patrimonioInicialTemporadaRaw = Number(
      usuario.patrimonioInicialTemporada
    );

    const temporadaInicializada =
      Boolean(usuario.temporadaRanking) &&
      Number.isFinite(patrimonioInicialTemporadaRaw) &&
      patrimonioInicialTemporadaRaw > 0;

    const patrimonioInicial = temporadaInicializada
      ? patrimonioInicialTemporadaRaw
      : Number(usuario.capitalInicial ?? 1000);

    if (!Number.isFinite(patrimonioInicial) || patrimonioInicial <= 0) {
      return null;
    }

    const resultado = patrimonio - patrimonioInicial;

    const rentabilidade = round2(
      (resultado / patrimonioInicial) * 100
    );

    if (rentabilidade <= 0) {
      return null;
    }

    const milestonesAtingidos = RENTABILIDADE_MILESTONES.filter(
      (milestone) => rentabilidade >= milestone
    );

    if (!milestonesAtingidos.length) {
      return null;
    }

    const eventosCriados = [];

    for (const milestone of milestonesAtingidos) {
      const eventoExistente = await SocialFeedEvent.findOne({
        tipo: 'MILESTONE_RENTABILITY',
        usuarioId: usuario._id,
        status: 'ativo',
        'metadata.milestone': milestone,
      })
        .select('_id')
        .lean();

      if (eventoExistente) {
        continue;
      }

      const evento = await criarEventoMilestoneRentabilidade({
        usuario,
        rentabilidade,
        milestone,
        patrimonio,
        patrimonioInicial,
        origem,
      });

      eventosCriados.push(evento);
    }

    return {
      usuarioId: String(usuario._id),
      rentabilidade,
      patrimonio,
      patrimonioInicial,
      eventosCriados: eventosCriados.length,
    };
  } catch (err) {
    console.error(
      'Erro ao verificar milestone de rentabilidade:',
      err
    );

    return null;
  }
}

module.exports = {
  RENTABILIDADE_MILESTONES,
  verificarMilestoneRentabilidadeUsuario,
};
const express = require('express');

const router = express.Router();

const auth = require('../middleware/auth');
const requirePremium = require('../middleware/requirePremium');

const User = require('../models/User');
const PrivateRanking = require('../models/PrivateRanking');
const PrivateRankingMember = require('../models/PrivateRankingMember');
const PrivateRankingInvite = require('../models/PrivateRankingInvite');
const SocialFeedEvent = require('../models/SocialFeedEvent');

const {
  obterPlanoEfetivo,
  obterLimitesDoPlano,
} = require('../utils/planFeatures');

router.use(auth);

function criarIdNotificacao(prefix = 'notif') {
  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function adicionarNotificacaoUsuario(
  usuarioId,
  {
    title,
    body,
    metadata = {},
  }
) {
  const usuario = await User.findById(usuarioId);

  if (!usuario) return null;

  if (!Array.isArray(usuario.notificacoes)) {
    usuario.notificacoes = [];
  }

  usuario.notificacoes.unshift({
    id: criarIdNotificacao('ranking_invite'),
    title,
    body,
    read: false,
    createdAt: new Date(),
    metadata,
  });

  usuario.notificacoes = usuario.notificacoes.slice(0, 100);

  usuario.markModified('notificacoes');

  await usuario.save();

  return usuario.notificacoes[0];
}

function montarUsuarioPublico(usuario) {
  if (!usuario) return null;

  const plano = obterPlanoEfetivo(usuario);

  return {
    id: String(usuario._id),
    nome: usuario.nome || '',
    nomeUsuario: usuario.nomeUsuario || '',
    nomePublico:
      usuario.nomeUsuario ||
      usuario.nome ||
      'Usuário',
    plano,
    premiumAtivo: plano === 'premium',
  };
}

async function recalcularTotalParticipantes(rankingId) {
  const total = await PrivateRankingMember.countDocuments({
    rankingId,
    status: 'aprovado',
  });

  await PrivateRanking.findByIdAndUpdate(rankingId, {
    $set: {
      totalParticipantes: total,
    },
  });

  return total;
}

async function popularConvites(convites) {
  const rankingIds = convites.map((c) => c.rankingId);
  const remetenteIds = convites.map((c) => c.remetenteId);
  const destinatarioIds = convites.map((c) => c.destinatarioId);

  const [rankings, remetentes, destinatarios] =
    await Promise.all([
      PrivateRanking.find({
        _id: { $in: rankingIds },
      })
        .select(
          [
            '_id',
            'nome',
            'descricao',
            'codigoConvite',
            'status',
            'totalParticipantes',
            'maxParticipantes',
            'criadorId',
          ].join(' ')
        )
        .lean(),

      User.find({
        _id: { $in: remetenteIds },
      })
        .select(
          [
            '_id',
            'nome',
            'nomeUsuario',
            'plano',
            'premiumAtivo',
            'premiumInicio',
            'premiumFim',
          ].join(' ')
        )
        .lean(),

      User.find({
        _id: { $in: destinatarioIds },
      })
        .select(
          [
            '_id',
            'nome',
            'nomeUsuario',
            'plano',
            'premiumAtivo',
            'premiumInicio',
            'premiumFim',
          ].join(' ')
        )
        .lean(),
    ]);

  const rankingsPorId = new Map(
    rankings.map((r) => [String(r._id), r])
  );

  const remetentesPorId = new Map(
    remetentes.map((u) => [String(u._id), u])
  );

  const destinatariosPorId = new Map(
    destinatarios.map((u) => [String(u._id), u])
  );

  return convites.map((convite) => {
    const ranking = rankingsPorId.get(
      String(convite.rankingId)
    );

    const remetente = remetentesPorId.get(
      String(convite.remetenteId)
    );

    const destinatario = destinatariosPorId.get(
      String(convite.destinatarioId)
    );

    return {
      id: String(convite._id),
      rankingId: String(convite.rankingId),
      remetenteId: String(convite.remetenteId),
      destinatarioId: String(convite.destinatarioId),

      status: convite.status,
      mensagem: convite.mensagem || '',

      enviadoEm: convite.enviadoEm || convite.createdAt || null,
      respondidoEm: convite.respondidoEm || null,
      aceitoEm: convite.aceitoEm || null,
      recusadoEm: convite.recusadoEm || null,
      canceladoEm: convite.canceladoEm || null,
      expiradoEm: convite.expiradoEm || null,
      expiraEm: convite.expiraEm || null,

      ranking: ranking
        ? {
            id: String(ranking._id),
            nome: ranking.nome,
            descricao: ranking.descricao || '',
            codigoConvite: ranking.codigoConvite || '',
            status: ranking.status,
            totalParticipantes: Number(
              ranking.totalParticipantes || 0
            ),
            maxParticipantes: Number(
              ranking.maxParticipantes || 0
            ),
            criadorId: String(ranking.criadorId),
          }
        : null,

      remetente: montarUsuarioPublico(remetente),
      destinatario: montarUsuarioPublico(destinatario),
    };
  });
}

async function criarEventoFeedSocial({
  tipo,
  usuarioId,
  usuarioAlvoId = null,
  rankingPrivadoId = null,
  titulo = '',
  mensagem = '',
  targetUrl = '',
  relevancia = 0,
  metadata = {},
}) {
  try {
    return await SocialFeedEvent.create({
      tipo,
      usuarioId,
      usuarioAlvoId,
      rankingPrivadoId,
      titulo,
      mensagem,
      targetUrl,
      visibilidade: 'publico',
      status: 'ativo',
      relevancia,
      metadata,
    });
  } catch (err) {
    console.error('Erro ao criar evento do feed social:', err);
    return null;
  }
}

/**
 * POST /ranking-convites
 *
 * Envia convite para um usuário participar de um ranking privado.
 *
 * body:
 * {
 *   rankingId: "...",
 *   destinatarioId: "...",
 *   mensagem: "opcional"
 * }
 */
router.post('/', requirePremium, async (req, res) => {
  try {
    const remetenteId = req.usuario.id;

    const {
      rankingId,
      destinatarioId,
      mensagem = '',
    } = req.body || {};

    if (!rankingId) {
      return res.status(400).json({
        erro: 'rankingId é obrigatório.',
      });
    }

    if (!destinatarioId) {
      return res.status(400).json({
        erro: 'destinatarioId é obrigatório.',
      });
    }

    if (String(remetenteId) === String(destinatarioId)) {
      return res.status(400).json({
        erro: 'Você não pode convidar a si mesmo.',
      });
    }

    const [ranking, destinatario, remetente] =
      await Promise.all([
        PrivateRanking.findById(rankingId),

        User.findById(destinatarioId)
          .select(
            [
              '_id',
              'rankingAtivo',
              'plano',
              'premiumAtivo',
              'premiumInicio',
              'premiumFim',
            ].join(' ')
          )
          .lean(),

        User.findById(remetenteId)
          .select(
            [
              '_id',
              'plano',
              'premiumAtivo',
              'premiumInicio',
              'premiumFim',
            ].join(' ')
          )
          .lean(),
      ]);

    if (!ranking || ranking.status !== 'ativo') {
      return res.status(404).json({
        erro: 'Ranking privado não encontrado ou inativo.',
      });
    }

    if (String(ranking.criadorId) !== String(remetenteId)) {
      return res.status(403).json({
        erro:
          'Apenas o criador pode convidar usuários para este ranking privado.',
      });
    }

    if (!destinatario || destinatario.rankingAtivo === false) {
      return res.status(404).json({
        erro: 'Usuário destinatário não encontrado.',
      });
    }

    const planoDestinatario = obterPlanoEfetivo(destinatario);

    if (planoDestinatario !== 'premium') {
      return res.status(403).json({
        erro:
          'Apenas usuários Premium podem participar de rankings privados.',
        codigo: 'DESTINATARIO_PREMIUM_NECESSARIO',
      });
    }

    const membroExistente =
      await PrivateRankingMember.findOne({
        rankingId: ranking._id,
        usuarioId: destinatarioId,
        status: {
          $in: ['aprovado', 'pendente'],
        },
      }).lean();

    if (membroExistente) {
      return res.status(409).json({
        erro:
          'Este usuário já participa ou já possui solicitação pendente neste ranking.',
        codigo: 'USUARIO_JA_VINCULADO_AO_RANKING',
      });
    }

    const convitePendente =
      await PrivateRankingInvite.findOne({
        rankingId: ranking._id,
        destinatarioId,
        status: 'pendente',
      }).lean();

    if (convitePendente) {
      return res.status(409).json({
        erro:
          'Já existe um convite pendente para este usuário neste ranking.',
        codigo: 'CONVITE_PENDENTE_EXISTENTE',
      });
    }

    const totalParticipantes =
      await PrivateRankingMember.countDocuments({
        rankingId: ranking._id,
        status: 'aprovado',
      });

    if (
      totalParticipantes >=
      Number(ranking.maxParticipantes || 50)
    ) {
      return res.status(403).json({
        erro:
          'Este ranking privado atingiu o limite de participantes.',
        codigo: 'RANKING_PRIVADO_LOTADO',
      });
    }

    const limitesDestinatario =
      obterLimitesDoPlano(destinatario);

    const totalParticipandoDestinatario =
      await PrivateRankingMember.countDocuments({
        usuarioId: destinatarioId,
        status: {
          $in: ['aprovado', 'pendente'],
        },
      });

    const totalConvitesPendentesDestinatario =
      await PrivateRankingInvite.countDocuments({
        destinatarioId,
        status: 'pendente',
      });

    const totalComprometido =
      totalParticipandoDestinatario +
      totalConvitesPendentesDestinatario;

    if (
      limitesDestinatario.rankingsPrivadosParticipando != null &&
      totalComprometido >=
        limitesDestinatario.rankingsPrivadosParticipando
    ) {
      return res.status(403).json({
        erro:
          'O usuário convidado atingiu o limite de rankings privados em participação.',
        codigo: 'DESTINATARIO_LIMITE_RANKINGS_PRIVADOS',
        limite:
          limitesDestinatario.rankingsPrivadosParticipando,
      });
    }

    const agora = new Date();

    const convite = await PrivateRankingInvite.create({
      rankingId: ranking._id,
      remetenteId,
      destinatarioId,
      status: 'pendente',
      mensagem: String(mensagem || '').trim(),
      enviadoEm: agora,
      expiraEm: null,
      metadata: {
        origem: 'perfil_publico',
        planoRemetente: obterPlanoEfetivo(remetente),
        planoDestinatario,
      },
    });

    await adicionarNotificacaoUsuario(destinatarioId, {
      title: 'Novo convite para ranking privado',
      body: `Você recebeu um convite para participar do ranking privado "${ranking.nome}".`,
      metadata: {
        tipo: 'PRIVATE_RANKING_INVITE',
        targetUrl: '/convites',
        conviteId: String(convite._id),
        rankingId: String(ranking._id),
        rankingNome: ranking.nome,
        remetenteId: String(remetenteId),
        destinatarioId: String(destinatarioId),
      },
    });

    const [conviteDetalhado] = await popularConvites([
      convite.toObject(),
    ]);

    return res.status(201).json({
      ok: true,
      convite: conviteDetalhado,
    });
  } catch (err) {
    console.error(
      'Erro ao enviar convite de ranking privado:',
      err
    );

    if (err?.code === 11000) {
      return res.status(409).json({
        erro: 'Conflito ao enviar convite. Tente novamente.',
      });
    }

    return res.status(500).json({
      erro:
        'Erro interno ao enviar convite de ranking privado.',
    });
  }
});

/**
 * GET /ranking-convites/recebidos
 *
 * Lista convites recebidos pelo usuário logado.
 */
router.get('/recebidos', requirePremium, async (req, res) => {
  try {
    const status = String(req.query.status || '')
      .trim()
      .toLowerCase();

    const filtro = {
      destinatarioId: req.usuario.id,
    };

    if (status) {
      filtro.status = status;
    } else {
      filtro.status = {
        $in: ['pendente', 'aceito', 'recusado'],
      };
    }

    const convites = await PrivateRankingInvite.find(filtro)
      .sort({
        createdAt: -1,
      })
      .limit(100)
      .lean();

    const resposta = await popularConvites(convites);

    return res.json({
      ok: true,
      convites: resposta,
    });
  } catch (err) {
    console.error(
      'Erro ao listar convites recebidos:',
      err
    );

    return res.status(500).json({
      erro: 'Erro interno ao listar convites recebidos.',
    });
  }
});

/**
 * GET /ranking-convites/enviados
 *
 * Lista convites enviados pelo usuário logado.
 */
router.get('/enviados', requirePremium, async (req, res) => {
  try {
    const status = String(req.query.status || '')
      .trim()
      .toLowerCase();

    const filtro = {
      remetenteId: req.usuario.id,
    };

    if (status) {
      filtro.status = status;
    } else {
      filtro.status = {
        $in: ['pendente', 'aceito', 'recusado', 'cancelado'],
      };
    }

    const convites = await PrivateRankingInvite.find(filtro)
      .sort({
        createdAt: -1,
      })
      .limit(100)
      .lean();

    const resposta = await popularConvites(convites);

    return res.json({
      ok: true,
      convites: resposta,
    });
  } catch (err) {
    console.error(
      'Erro ao listar convites enviados:',
      err
    );

    return res.status(500).json({
      erro: 'Erro interno ao listar convites enviados.',
    });
  }
});

/**
 * POST /ranking-convites/:id/aceitar
 *
 * Aceita convite recebido e cria vínculo no PrivateRankingMember.
 */
router.post('/:id/aceitar', requirePremium, async (req, res) => {
  try {
    const convite = await PrivateRankingInvite.findById(
      req.params.id
    );

    if (!convite) {
      return res.status(404).json({
        erro: 'Convite não encontrado.',
      });
    }

    if (
      String(convite.destinatarioId) !==
      String(req.usuario.id)
    ) {
      return res.status(403).json({
        erro: 'Este convite não pertence ao usuário logado.',
      });
    }

    if (convite.status !== 'pendente') {
      return res.status(409).json({
        erro: 'Este convite não está pendente.',
        codigo: 'CONVITE_NAO_PENDENTE',
      });
    }

    if (
      convite.expiraEm &&
      new Date(convite.expiraEm).getTime() < Date.now()
    ) {
      const agoraExpiracao = new Date();

      convite.status = 'expirado';
      convite.expiradoEm = agoraExpiracao;
      convite.respondidoEm = agoraExpiracao;

      await convite.save();

      return res.status(409).json({
        erro: 'Este convite expirou.',
        codigo: 'CONVITE_EXPIRADO',
      });
      
    }

    const [ranking, usuario] = await Promise.all([
      PrivateRanking.findById(convite.rankingId),

      User.findById(req.usuario.id)
        .select(
          [
            '_id',
            'plano',
            'premiumAtivo',
            'premiumInicio',
            'premiumFim',
          ].join(' ')
        )
        .lean(),
    ]);

    if (!ranking || ranking.status !== 'ativo') {
      return res.status(404).json({
        erro: 'Ranking privado não encontrado ou inativo.',
      });
    }

    const plano = obterPlanoEfetivo(usuario);

    if (plano !== 'premium') {
      return res.status(403).json({
        erro:
          'Apenas usuários Premium podem participar de rankings privados.',
        codigo: 'PREMIUM_NECESSARIO',
      });
    }

    const membroExistente =
      await PrivateRankingMember.findOne({
        rankingId: ranking._id,
        usuarioId: req.usuario.id,
        status: {
          $in: ['aprovado', 'pendente'],
        },
      });

    if (membroExistente) {
      const agora = new Date();

      convite.status = 'aceito';
      convite.respondidoEm = agora;
      convite.aceitoEm = agora;

      await convite.save();

      const totalAtualizado =
        await recalcularTotalParticipantes(ranking._id);

      await adicionarNotificacaoUsuario(convite.remetenteId, {
        title: 'Convite aceito',
        body: `Seu convite para o ranking privado "${ranking.nome}" foi aceito.`,
        metadata: {
          tipo: 'PRIVATE_RANKING_INVITE_ACCEPTED',
          targetUrl: '/convites',
          conviteId: String(convite._id),
          rankingId: String(ranking._id),
          rankingNome: ranking.nome,
          remetenteId: String(convite.remetenteId),
          destinatarioId: String(convite.destinatarioId),
        },
      });

      const [conviteDetalhado] = await popularConvites([
        convite.toObject(),
      ]);
      
      const usuarioAceitou = await User.findById(req.usuario.id)
  .select('nome nomeUsuario')
  .lean();
  
      const nomeUsuario =
  usuarioAceitou?.nomeUsuario ||
  usuarioAceitou?.nome ||
  'Um usuário';

await criarEventoFeedSocial({
  tipo: 'PRIVATE_RANKING_JOINED',
  usuarioId: req.usuario.id,
  usuarioAlvoId: convite.remetenteId,
  rankingPrivadoId: ranking._id,
  titulo: `@${nomeUsuario} entrou em um ranking privado`,
  mensagem: `Agora participa do ranking ${ranking.nome}.`,
  targetUrl: '/ranking',
  relevancia: 2,
  metadata: {
    origem: 'private_ranking_joined_by_invite',
    conviteId: String(convite._id),
    rankingId: String(ranking._id),
    rankingNome: ranking.nome,
    remetenteId: String(convite.remetenteId),
  },
});

      return res.json({
        ok: true,
        convite: conviteDetalhado,
        membro: membroExistente,
        totalParticipantes: totalAtualizado,
      });
    }

    const totalParticipantes =
      await PrivateRankingMember.countDocuments({
        rankingId: ranking._id,
        status: 'aprovado',
      });

    if (
      totalParticipantes >=
      Number(ranking.maxParticipantes || 50)
    ) {
      return res.status(403).json({
        erro:
          'Este ranking privado atingiu o limite de participantes.',
        codigo: 'RANKING_PRIVADO_LOTADO',
      });
    }

    const limites = obterLimitesDoPlano(usuario);

    const totalParticipando =
      await PrivateRankingMember.countDocuments({
        usuarioId: req.usuario.id,
        status: {
          $in: ['aprovado', 'pendente'],
        },
      });

    if (
      limites.rankingsPrivadosParticipando != null &&
      totalParticipando >=
        limites.rankingsPrivadosParticipando
    ) {
      return res.status(403).json({
        erro:
          'Você atingiu o limite de rankings privados em participação.',
        codigo: 'LIMITE_RANKINGS_PRIVADOS_PARTICIPANDO',
        limite: limites.rankingsPrivadosParticipando,
      });
    }

    const agora = new Date();

    const membro = await PrivateRankingMember.findOneAndUpdate(
      {
        rankingId: ranking._id,
        usuarioId: req.usuario.id,
      },
      {
        $set: {
          status: 'aprovado',
          entrouEm: agora,
          aprovadoEm: agora,
          aprovadoPor: convite.remetenteId,
          convidadoEm:
            convite.enviadoEm ||
            convite.createdAt ||
            agora,
          removidoEm: null,
          recusadoEm: null,
          saiuEm: null,
          metadata: {
            origem: 'convite_social',
            conviteId: String(convite._id),
          },
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    convite.status = 'aceito';
    convite.respondidoEm = agora;
    convite.aceitoEm = agora;

    await convite.save();

    const totalAtualizado =
      await recalcularTotalParticipantes(ranking._id);

    await adicionarNotificacaoUsuario(convite.remetenteId, {
      title: 'Convite aceito',
      body: `Seu convite para o ranking privado "${ranking.nome}" foi aceito.`,
      metadata: {
        tipo: 'PRIVATE_RANKING_INVITE_ACCEPTED',
        targetUrl: '/convites',
        conviteId: String(convite._id),
        rankingId: String(ranking._id),
        rankingNome: ranking.nome,
        remetenteId: String(convite.remetenteId),
        destinatarioId: String(convite.destinatarioId),
      },
    });

    const [conviteDetalhado] = await popularConvites([
      convite.toObject(),
    ]);

    return res.json({
      ok: true,
      convite: conviteDetalhado,
      membro,
      totalParticipantes: totalAtualizado,
    });
  } catch (err) {
    console.error(
      'Erro ao aceitar convite de ranking privado:',
      err
    );

    if (err?.code === 11000) {
      return res.status(409).json({
        erro: 'Você já participa deste ranking privado.',
      });
    }

    return res.status(500).json({
      erro:
        'Erro interno ao aceitar convite de ranking privado.',
    });
  }
});

/**
 * POST /ranking-convites/:id/recusar
 *
 * Recusa convite recebido.
 */
router.post('/:id/recusar', requirePremium, async (req, res) => {
  try {
    const convite = await PrivateRankingInvite.findById(
      req.params.id
    );

    if (!convite) {
      return res.status(404).json({
        erro: 'Convite não encontrado.',
      });
    }

    if (
      String(convite.destinatarioId) !==
      String(req.usuario.id)
    ) {
      return res.status(403).json({
        erro: 'Este convite não pertence ao usuário logado.',
      });
    }

    if (convite.status !== 'pendente') {
      return res.status(409).json({
        erro: 'Este convite não está pendente.',
        codigo: 'CONVITE_NAO_PENDENTE',
      });
    }

    const agora = new Date();

    convite.status = 'recusado';
    convite.respondidoEm = agora;
    convite.recusadoEm = agora;

    await convite.save();

    const ranking = await PrivateRanking.findById(
      convite.rankingId
    )
      .select('nome')
      .lean();

    await adicionarNotificacaoUsuario(convite.remetenteId, {
      title: 'Convite recusado',
      body: `Seu convite para o ranking privado "${
        ranking?.nome || 'Ranking privado'
      }" foi recusado.`,
      metadata: {
        tipo: 'PRIVATE_RANKING_INVITE_REFUSED',
        targetUrl: '/convites',
        conviteId: String(convite._id),
        rankingId: String(convite.rankingId),
        rankingNome: ranking?.nome || '',
        remetenteId: String(convite.remetenteId),
        destinatarioId: String(convite.destinatarioId),
      },
    });

    const [conviteDetalhado] = await popularConvites([
      convite.toObject(),
    ]);

    return res.json({
      ok: true,
      convite: conviteDetalhado,
    });
  } catch (err) {
    console.error(
      'Erro ao recusar convite de ranking privado:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao recusar convite de ranking privado.',
    });
  }
});

/**
 * POST /ranking-convites/:id/cancelar
 *
 * Cancela convite enviado pelo remetente, enquanto ainda está pendente.
 */
router.post('/:id/cancelar', requirePremium, async (req, res) => {
  try {
    const convite = await PrivateRankingInvite.findById(
      req.params.id
    );

    if (!convite) {
      return res.status(404).json({
        erro: 'Convite não encontrado.',
      });
    }

    if (
      String(convite.remetenteId) !==
      String(req.usuario.id)
    ) {
      return res.status(403).json({
        erro: 'Apenas quem enviou o convite pode cancelá-lo.',
      });
    }

    if (convite.status !== 'pendente') {
      return res.status(409).json({
        erro: 'Este convite não está pendente.',
        codigo: 'CONVITE_NAO_PENDENTE',
      });
    }

    const agora = new Date();

    convite.status = 'cancelado';
    convite.respondidoEm = agora;
    convite.canceladoEm = agora;

    await convite.save();

    const [conviteDetalhado] = await popularConvites([
      convite.toObject(),
    ]);

    return res.json({
      ok: true,
      convite: conviteDetalhado,
    });
  } catch (err) {
    console.error(
      'Erro ao cancelar convite de ranking privado:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao cancelar convite de ranking privado.',
    });
  }
});

module.exports = router;
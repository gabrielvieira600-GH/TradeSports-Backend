const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Trophy = require('../models/Trophy');

const router = express.Router();
router.use(auth);

function normalizarTrofeu(trofeu) {
  return {
    id: String(trofeu._id),
    periodoTipo: trofeu.periodoTipo,
    periodoChave: trofeu.periodoChave,
    periodoLabel: trofeu.periodoLabel,
    categoria: trofeu.categoria,
    posicao: Number(trofeu.posicao),
    rankingPrivadoId: trofeu.rankingPrivadoId
      ? String(trofeu.rankingPrivadoId)
      : null,
    rankingNome: trofeu.rankingNome || '',
    titulo: trofeu.titulo,
    descricao: trofeu.descricao,
    designKey: trofeu.designKey,
    concedidoEm: trofeu.concedidoEm,
  };
}

router.get('/usuarios/:usuarioId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.usuarioId)) {
      return res.status(400).json({ erro: 'Usuário inválido.' });
    }

    const pagina = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limite = Math.min(
      500,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 100)
    );
    const filtro = { usuarioId: req.params.usuarioId };
    const periodoTipo = String(req.query.periodoTipo || '').trim().toLowerCase();
    const categoria = String(req.query.categoria || '').trim().toLowerCase();

    if (periodoTipo && ['semana', 'mes', 'temporada'].includes(periodoTipo)) {
      filtro.periodoTipo = periodoTipo;
    }
    if (categoria && ['geral', 'premium', 'privado'].includes(categoria)) {
      filtro.categoria = categoria;
    }

    const [trofeus, total, agregados] = await Promise.all([
      Trophy.find(filtro)
        .sort({ concedidoEm: -1, posicao: 1 })
        .skip((pagina - 1) * limite)
        .limit(limite)
        .lean(),
      Trophy.countDocuments(filtro),
      Trophy.aggregate([
        { $match: { usuarioId: new mongoose.Types.ObjectId(req.params.usuarioId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            primeiros: { $sum: { $cond: [{ $eq: ['$posicao', 1] }, 1, 0] } },
            segundos: { $sum: { $cond: [{ $eq: ['$posicao', 2] }, 1, 0] } },
            terceiros: { $sum: { $cond: [{ $eq: ['$posicao', 3] }, 1, 0] } },
            semanais: { $sum: { $cond: [{ $eq: ['$periodoTipo', 'semana'] }, 1, 0] } },
            mensais: { $sum: { $cond: [{ $eq: ['$periodoTipo', 'mes'] }, 1, 0] } },
            temporadas: { $sum: { $cond: [{ $eq: ['$periodoTipo', 'temporada'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const resumo = agregados[0] || {
      total: 0,
      primeiros: 0,
      segundos: 0,
      terceiros: 0,
      semanais: 0,
      mensais: 0,
      temporadas: 0,
    };

    return res.json({
      ok: true,
      pagina,
      limite,
      total,
      totalPaginas: Math.max(1, Math.ceil(total / limite)),
      resumo: {
        total: Number(resumo.total || 0),
        primeiros: Number(resumo.primeiros || 0),
        segundos: Number(resumo.segundos || 0),
        terceiros: Number(resumo.terceiros || 0),
        semanais: Number(resumo.semanais || 0),
        mensais: Number(resumo.mensais || 0),
        temporadas: Number(resumo.temporadas || 0),
      },
      trofeus: trofeus.map(normalizarTrofeu),
    });
  } catch (erro) {
    console.error('[TROFEUS] Erro ao carregar sala:', erro);
    return res.status(500).json({ erro: 'Não foi possível carregar a Sala de Troféus.' });
  }
});

module.exports = router;

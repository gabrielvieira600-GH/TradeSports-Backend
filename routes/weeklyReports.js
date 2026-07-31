const express = require('express');

const auth = require('../middleware/auth');
const User = require('../models/User');
const WeeklyPerformanceReport = require('../models/WeeklyPerformanceReport');
const { obterPlanoEfetivo } = require('../utils/planFeatures');
const { garantirRelatorioSemanal } = require('../utils/weeklyPerformanceReport');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id);
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    const premium = obterPlanoEfetivo(usuario) === 'premium';
    if (!premium) {
      return res.json({ plano: 'lite', premium: false, previaLite: true, relatorios: [] });
    }
    await garantirRelatorioSemanal(usuario);
    await usuario.save();
    const relatorios = await WeeklyPerformanceReport.find({ usuarioId: usuario._id })
      .sort({ inicio: -1 })
      .select('chaveSemana inicio fim geradoEm resumo qualidadeDados')
      .lean();
    return res.json({ plano: 'premium', premium: true, relatorios });
  } catch (err) {
    console.error('Erro ao listar relatórios semanais:', err);
    return res.status(500).json({ erro: 'Erro interno ao carregar os relatórios semanais.' });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const usuario = await User.findById(req.usuario.id).lean();
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (obterPlanoEfetivo(usuario) !== 'premium') {
      return res.status(403).json({ erro: 'Este relatório é exclusivo para assinantes Premium.', premiumNecessario: true });
    }
    const relatorio = await WeeklyPerformanceReport.findOne({ _id: req.params.id, usuarioId: usuario._id }).lean();
    if (!relatorio) return res.status(404).json({ erro: 'Relatório semanal não encontrado.' });
    return res.json({ premium: true, relatorio });
  } catch (err) {
    if (err?.name === 'CastError') return res.status(404).json({ erro: 'Relatório semanal não encontrado.' });
    console.error('Erro ao carregar relatório semanal:', err);
    return res.status(500).json({ erro: 'Erro interno ao carregar o relatório semanal.' });
  }
});

module.exports = router;

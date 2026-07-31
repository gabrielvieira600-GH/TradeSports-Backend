const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Club = require('../models/Club');
const Order = require('../models/Order');
const AdvancedAlert = require('../models/AdvancedAlert');
const AdvancedAlertTrigger = require('../models/AdvancedAlertTrigger');
const { obterPlanoEfetivo } = require('../utils/planFeatures');
const { avaliarAlertasDoUsuario } = require('../utils/advancedAlerts');

const router = express.Router();
const TIPOS = ['PRECO_ACIMA','PRECO_ABAIXO','VARIACAO_PERCENTUAL','MELHOR_BID','MELHOR_ASK','SPREAD','ORDEM_EXECUCAO','IPO_ESGOTANDO','CLASSIFICACAO','TOP4','DIVIDENDOS','LIQUIDACAO'];
const TIPOS_COM_CLUBE = TIPOS.filter(t => !['ORDEM_EXECUCAO','LIQUIDACAO'].includes(t));

async function contexto(req, res) {
  const usuario = await User.findById(req.usuario.id);
  if (!usuario) { res.status(404).json({ erro: 'Usuário não encontrado.' }); return null; }
  return { usuario, premium: obterPlanoEfetivo(usuario) === 'premium' };
}

router.get('/', auth, async (req, res) => {
  try {
    const ctx = await contexto(req, res); if (!ctx) return;
    if (!ctx.premium) return res.json({ premium: false, plano: 'lite', previaLite: true, alertas: [], limiteAtivos: 50 });
    await avaliarAlertasDoUsuario(ctx.usuario); await ctx.usuario.save();
    const [alertas, totalAtivos] = await Promise.all([
      AdvancedAlert.find({ usuarioId: ctx.usuario._id }).sort({ status: 1, updatedAt: -1 }).lean(),
      AdvancedAlert.countDocuments({ usuarioId: ctx.usuario._id, status: 'ATIVO' })
    ]);
    return res.json({ premium: true, plano: 'premium', alertas, totalAtivos, limiteAtivos: 50 });
  } catch (err) { console.error('[ALERTAS GET]', err); return res.status(500).json({ erro: 'Erro ao carregar alertas.' }); }
});

router.get('/opcoes', auth, async (req, res) => {
  try {
    const ctx = await contexto(req, res); if (!ctx) return;
    if (!ctx.premium) return res.status(403).json({ erro: 'Recurso exclusivo Premium.', premiumNecessario: true });
    const [clubes, ordens] = await Promise.all([
      Club.find({}).sort({ nome: 1 }).select('_id legacyId nome escudo preco precoAtual posicao cotasDisponiveis ipoEncerrado').lean(),
      Order.find({ usuarioId: ctx.usuario._id, status: { $in: ['aberta','parcial'] } }).sort({ criadoEm: -1 }).limit(100).select('_id tipo preco quantidade restante status clubeLegacyId').lean()
    ]);
    return res.json({ tipos: TIPOS, clubes, ordens });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao carregar opções.' }); }
});

router.get('/historico', auth, async (req, res) => {
  try {
    const ctx = await contexto(req, res); if (!ctx) return;
    if (!ctx.premium) return res.status(403).json({ erro: 'Recurso exclusivo Premium.', premiumNecessario: true });
    const historico = await AdvancedAlertTrigger.find({ usuarioId: ctx.usuario._id }).sort({ disparadoEm: -1 }).limit(200).lean();
    return res.json({ historico });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao carregar histórico.' }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const ctx = await contexto(req, res); if (!ctx) return;
    if (!ctx.premium) return res.status(403).json({ erro: 'Alertas configuráveis são exclusivos Premium.', premiumNecessario: true });
    const ativos = await AdvancedAlert.countDocuments({ usuarioId: ctx.usuario._id, status: 'ATIVO' });
    if (ativos >= 50) return res.status(409).json({ erro: 'Limite de 50 alertas ativos atingido.' });
    const b = req.body || {}; const tipo = String(b.tipo || '').toUpperCase();
    if (!TIPOS.includes(tipo)) return res.status(400).json({ erro: 'Tipo de alerta inválido.' });
    let clube = null;
    if (TIPOS_COM_CLUBE.includes(tipo)) {
      clube = mongoose.Types.ObjectId.isValid(String(b.clubeId)) ? await Club.findById(b.clubeId) : await Club.findOne({ legacyId: Number(b.clubeId) });
      if (!clube) return res.status(400).json({ erro: 'Selecione um clube válido.' });
    }
    let ordem = null;
    if (tipo === 'ORDEM_EXECUCAO') {
      ordem = await Order.findOne({ _id: b.ordemId, usuarioId: ctx.usuario._id });
      if (!ordem) return res.status(400).json({ erro: 'Selecione uma ordem sua válida.' });
    }
    const exigeValor = !['ORDEM_EXECUCAO','CLASSIFICACAO','TOP4'].includes(tipo);
    const valorAlvo = b.valorAlvo == null || b.valorAlvo === '' ? null : Number(b.valorAlvo);
    if (exigeValor && (!Number.isFinite(valorAlvo) || valorAlvo < 0)) return res.status(400).json({ erro: 'Informe um valor-alvo válido.' });
    const precoBase = Number(clube?.precoAtual ?? clube?.preco ?? 0);
    const alerta = await AdvancedAlert.create({
      usuarioId: ctx.usuario._id, tipo, nome: String(b.nome || clube?.nome || 'Meu alerta').trim().slice(0,100),
      clubeId: clube?._id || null, clubeLegacyId: clube?.legacyId || ordem?.clubeLegacyId || null, clubeNome: clube?.nome || '',
      ordemId: ordem?._id || null, operador: ['ACIMA','ABAIXO','QUALQUER','ENTROU','SAIU'].includes(b.operador) ? b.operador : 'QUALQUER',
      valorAlvo, valorBase: tipo === 'VARIACAO_PERCENTUAL' ? precoBase : null,
      recorrente: b.recorrente !== false, cooldownMinutos: Math.min(10080, Math.max(15, Number(b.cooldownMinutos || 60)))
    });
    return res.status(201).json({ alerta });
  } catch (err) { console.error('[ALERTAS POST]', err); return res.status(500).json({ erro: 'Erro ao criar alerta.' }); }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const ctx = await contexto(req, res); if (!ctx) return;
    if (!ctx.premium) return res.status(403).json({ erro: 'Recurso exclusivo Premium.' });
    const alerta = await AdvancedAlert.findOne({ _id: req.params.id, usuarioId: ctx.usuario._id });
    if (!alerta) return res.status(404).json({ erro: 'Alerta não encontrado.' });
    if (req.body.status && ['ATIVO','PAUSADO'].includes(req.body.status)) {
      if (req.body.status === 'ATIVO' && alerta.status !== 'ATIVO') {
        const ativos = await AdvancedAlert.countDocuments({ usuarioId: ctx.usuario._id, status: 'ATIVO' });
        if (ativos >= 50) return res.status(409).json({ erro: 'Limite de 50 alertas ativos atingido.' });
      }
      alerta.status = req.body.status;
    }
    if (req.body.nome) alerta.nome = String(req.body.nome).trim().slice(0,100);
    await alerta.save(); return res.json({ alerta });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao atualizar alerta.' }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const ctx = await contexto(req, res); if (!ctx) return;
    if (!ctx.premium) return res.status(403).json({ erro: 'Recurso exclusivo Premium.' });
    const alerta = await AdvancedAlert.findOneAndDelete({ _id: req.params.id, usuarioId: ctx.usuario._id });
    if (!alerta) return res.status(404).json({ erro: 'Alerta não encontrado.' });
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao excluir alerta.' }); }
});

module.exports = router;

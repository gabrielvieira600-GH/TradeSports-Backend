const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const requirePremium = require('../middleware/requirePremium');
const User = require('../models/User');
const Club = require('../models/Club');
const RankingSeason = require('../models/RankingSeason');
const PrivateRanking = require('../models/PrivateRanking');
const PrivateRankingMember = require('../models/PrivateRankingMember');
const PrivateRankingPost = require('../models/PrivateRankingPost');
const { obterPlanoEfetivo, obterLimitesDoPlano } = require('../utils/planFeatures');
const { concederTrofeusPeriodo } = require('../services/trophyService');

const router = express.Router();
router.use(auth);

const idValido = (id) => mongoose.Types.ObjectId.isValid(id);
const round2 = (n) => Number(Number(n || 0).toFixed(2));

async function codigoUnico() {
  for (let i = 0; i < 10; i += 1) {
    const codigo = crypto.randomBytes(4).toString('hex');
    if (!(await PrivateRanking.exists({ codigoConvite: codigo }))) return codigo;
  }
  return `${crypto.randomBytes(5).toString('hex')}${Date.now().toString(36).slice(-3)}`;
}

async function contexto(rankingId, usuarioId) {
  if (!idValido(rankingId)) return null;
  const [ranking, membro] = await Promise.all([
    PrivateRanking.findById(rankingId).lean(),
    PrivateRankingMember.findOne({ rankingId, usuarioId }).lean(),
  ]);
  if (!ranking) return null;
  const proprietario = String(ranking.criadorId) === String(usuarioId);
  const papel = proprietario ? 'proprietario' : membro?.papel || 'participante';
  return {
    ranking,
    membro,
    papel,
    participante: proprietario || membro?.status === 'aprovado',
    podeGerir: proprietario || (membro?.status === 'aprovado' && papel === 'administrador'),
  };
}

async function calcularClassificacao(ranking) {
  const membros = await PrivateRankingMember.find({ rankingId: ranking._id, status: 'aprovado' }).lean();
  const ids = membros.map((m) => m.usuarioId);
  if (!ids.length) return [];
  const [usuarios, clubes] = await Promise.all([
    User.find({ _id: { $in: ids }, rankingAtivo: { $ne: false } }).select('_id nome nomeUsuario saldo capitalInicial carteira patrimonioInicialTemporada plano premiumAtivo premiumInicio premiumFim').lean(),
    Club.find({}).select('legacyId precoAtual preco').lean(),
  ]);
  const precos = new Map(clubes.map((c) => [String(c.legacyId), Number(c.precoAtual ?? c.preco ?? 0)]));
  const papel = new Map(membros.map((m) => [String(m.usuarioId), m.papel || m.metadata?.papel || 'participante']));
  const itens = usuarios.map((u) => {
    const saldo = Number(u.saldo || 0);
    const posicoes = (Array.isArray(u.carteira) ? u.carteira : []).reduce((acc, a) => {
      const clubeId = a.clubeId ?? a.clubeLegacyId ?? a.idClube ?? a.clube?.legacyId ?? a.clube?.id;
      const qtd = Number(a.quantidade ?? a.cotas ?? 0);
      const preco = precos.get(String(clubeId)) ?? Number(a.precoMedio ?? a.valorUnitario ?? 0);
      return acc + (Number.isFinite(qtd) && qtd > 0 ? qtd * preco : 0);
    }, 0);
    const patrimonio = round2(saldo + posicoes);
    const base = Number(u.patrimonioInicialTemporada || u.capitalInicial || 1000);
    const resultado = round2(patrimonio - base);
    return {
      usuarioId: String(u._id), nome: u.nome || '', nomeUsuario: u.nomeUsuario || '',
      plano: obterPlanoEfetivo(u), papel: papel.get(String(u._id)), patrimonio,
      resultado, rentabilidade: base > 0 ? round2((resultado / base) * 100) : 0,
    };
  });
  const criterio = ranking.criterioClassificacao || 'rentabilidade';
  itens.sort((a, b) => b[criterio] - a[criterio] || b.patrimonio - a.patrimonio || a.nomeUsuario.localeCompare(b.nomeUsuario, 'pt-BR'));
  return itens.map((item, index) => ({ posicao: index + 1, ...item }));
}

async function validarLimiteParticipacao(usuarioId, ignorarRankingId = null) {
  const usuario = await User.findById(usuarioId).select('plano premiumAtivo premiumInicio premiumFim').lean();
  if (!usuario) return { erro: 'Usuário não encontrado.', status: 404 };
  const limite = obterLimitesDoPlano(usuario).rankingsPrivadosParticipando;
  if (limite == null) return { usuario, limite: null };
  const filtro = { usuarioId, status: 'aprovado' };
  if (ignorarRankingId) filtro.rankingId = { $ne: ignorarRankingId };
  const total = await PrivateRankingMember.countDocuments(filtro);
  if (total >= limite) return { erro: `O plano Lite permite participar de até ${limite} competições privadas.`, status: 403, codigo: 'LIMITE_RANKINGS_LITE', limite };
  return { usuario, limite };
}

router.get('/', async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const membros = await PrivateRankingMember.find({ usuarioId, status: { $in: ['aprovado', 'pendente'] } }).lean();
    const ids = membros.map((m) => m.rankingId);
    const [usuario, rankings] = await Promise.all([
      User.findById(usuarioId).select('plano premiumAtivo premiumInicio premiumFim').lean(),
      PrivateRanking.find({ $or: [{ criadorId: usuarioId }, { _id: { $in: ids } }], status: { $ne: 'cancelado' } }).sort({ updatedAt: -1 }).lean(),
    ]);
    const mapa = new Map(membros.map((m) => [String(m.rankingId), m]));
    return res.json({ ok: true, plano: obterPlanoEfetivo(usuario), limiteLite: 2, rankings: rankings.map((r) => ({ ...r, papel: String(r.criadorId) === String(usuarioId) ? 'proprietario' : (mapa.get(String(r._id))?.papel || 'participante'), membroStatus: mapa.get(String(r._id))?.status || 'aprovado' })) });
  } catch (err) { console.error(err); return res.status(500).json({ erro: 'Erro ao listar competições privadas.' }); }
});

router.get('/publicos', async (_req, res) => {
  try {
    const rankings = await PrivateRanking.find({ visibilidade: 'publico', status: 'ativo' }).sort({ totalParticipantes: -1, createdAt: -1 }).limit(50).lean();
    return res.json({ ok: true, rankings });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao listar competições públicas.' }); }
});

router.post('/', requirePremium, async (req, res) => {
  try {
    const temporada = await RankingSeason.findOne({ status: 'ativa' }).sort({ iniciadaEm: -1, createdAt: -1 }).lean();
    if (!temporada) return res.status(409).json({ erro: 'Não existe temporada ativa.' });
    const b = req.body || {};
    if (!String(b.nome || '').trim()) return res.status(400).json({ erro: 'Informe o nome da competição.' });
    const inicio = b.dataInicio ? new Date(b.dataInicio) : new Date();
    const fim = b.dataFim ? new Date(b.dataFim) : null;
    if (fim && (!Number.isFinite(fim.getTime()) || fim <= inicio)) return res.status(400).json({ erro: 'A data final deve ser posterior à inicial.' });
    const ranking = await PrivateRanking.create({
      nome: String(b.nome).trim(), descricao: String(b.descricao || '').trim(), imagemUrl: String(b.imagemUrl || '').trim(),
      criadorId: req.usuario.id, temporadaId: temporada._id, codigoConvite: await codigoUnico(), status: 'ativo',
      visibilidade: b.visibilidade === 'publico' ? 'publico' : 'convite', aprovacaoManual: Boolean(b.aprovacaoManual),
      criterioClassificacao: ['rentabilidade', 'patrimonio', 'resultado'].includes(b.criterioClassificacao) ? b.criterioClassificacao : 'rentabilidade',
      regras: String(b.regras || '').trim(), dataInicio: inicio, dataFim: fim,
      maxParticipantes: Math.min(500, Math.max(2, Number(b.maxParticipantes || 50))), totalParticipantes: 1,
    });
    await PrivateRankingMember.create({ rankingId: ranking._id, usuarioId: req.usuario.id, status: 'aprovado', papel: 'proprietario', entrouEm: new Date(), aprovadoEm: new Date(), aprovadoPor: req.usuario.id, metadata: { papel: 'criador' } });
    return res.status(201).json({ ok: true, ranking, linkConvite: `/rankings-privados?codigo=${ranking.codigoConvite}` });
  } catch (err) { console.error(err); return res.status(500).json({ erro: 'Erro ao criar competição privada.' }); }
});

router.post('/entrar/:codigo', async (req, res) => {
  try {
    const ranking = await PrivateRanking.findOne({ codigoConvite: String(req.params.codigo || '').toLowerCase(), status: 'ativo' });
    if (!ranking) return res.status(404).json({ erro: 'Código de convite inválido ou expirado.' });
    if (String(ranking.criadorId) === String(req.usuario.id)) return res.json({ ok: true, rankingId: ranking._id });
    const existente = await PrivateRankingMember.findOne({ rankingId: ranking._id, usuarioId: req.usuario.id });
    if (existente?.status === 'bloqueado') return res.status(403).json({ erro: 'Seu acesso a esta competição foi bloqueado.' });
    if (existente?.status === 'aprovado') return res.json({ ok: true, rankingId: ranking._id });
    const limite = await validarLimiteParticipacao(req.usuario.id, ranking._id);
    if (limite.erro) return res.status(limite.status).json(limite);
    if (ranking.totalParticipantes >= ranking.maxParticipantes) return res.status(409).json({ erro: 'A competição atingiu o limite de participantes.' });
    const status = ranking.aprovacaoManual ? 'pendente' : 'aprovado';
    await PrivateRankingMember.findOneAndUpdate({ rankingId: ranking._id, usuarioId: req.usuario.id }, { $set: { status, papel: 'participante', entrouEm: status === 'aprovado' ? new Date() : null, aprovadoEm: status === 'aprovado' ? new Date() : null } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    if (status === 'aprovado') await PrivateRanking.updateOne({ _id: ranking._id }, { $inc: { totalParticipantes: 1 } });
    return res.json({ ok: true, rankingId: ranking._id, status });
  } catch (err) { console.error(err); return res.status(500).json({ erro: 'Erro ao entrar na competição.' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const ctx = await contexto(req.params.id, req.usuario.id);
    if (!ctx) return res.status(404).json({ erro: 'Competição não encontrada.' });
    if (!ctx.participante && ctx.ranking.visibilidade !== 'publico') return res.status(403).json({ erro: 'Esta competição é acessível somente por convite.' });
    const [classificacao, membros, posts, campeoes] = await Promise.all([
      calcularClassificacao(ctx.ranking),
      PrivateRankingMember.find({ rankingId: ctx.ranking._id, status: { $in: ['aprovado', 'pendente', 'bloqueado'] } }).populate('usuarioId', 'nome nomeUsuario plano').sort({ entrouEm: 1 }).lean(),
      ctx.participante ? PrivateRankingPost.find({ rankingId: ctx.ranking._id, status: 'ativo' }).populate('autorId', 'nome nomeUsuario plano').sort({ createdAt: -1 }).limit(100).lean() : [],
      PrivateRanking.find({ criadorId: ctx.ranking.criadorId, status: { $in: ['encerrado', 'arquivado'] }, campeaoUsuarioId: { $ne: null } }).populate('campeaoUsuarioId', 'nome nomeUsuario').sort({ encerradoEm: -1 }).limit(20).lean(),
    ]);
    const patrimonioMedio = classificacao.length ? round2(classificacao.reduce((s, x) => s + x.patrimonio, 0) / classificacao.length) : 0;
    return res.json({ ok: true, ranking: ctx.ranking, papel: ctx.papel, participante: ctx.participante, podeGerir: ctx.podeGerir, linkConvite: `/rankings-privados?codigo=${ctx.ranking.codigoConvite}`, classificacao, membros, posts, estatisticas: { participantes: classificacao.length, patrimonioMedio, rentabilidadeMedia: classificacao.length ? round2(classificacao.reduce((s, x) => s + x.rentabilidade, 0) / classificacao.length) : 0, lider: classificacao[0] || null }, historicoCampeoes: campeoes.map((r) => ({ rankingId: r._id, nome: r.nome, encerradoEm: r.encerradoEm, campeao: r.campeaoUsuarioId, trofeu: r.resultadoFinal?.trofeu || 'Campeão' })) });
  } catch (err) { console.error(err); return res.status(500).json({ erro: 'Erro ao carregar competição.' }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const ctx = await contexto(req.params.id, req.usuario.id);
    if (!ctx) return res.status(404).json({ erro: 'Competição não encontrada.' });
    if (!ctx.podeGerir) return res.status(403).json({ erro: 'Apenas proprietário ou administrador pode editar.' });
    if (!['ativo', 'rascunho'].includes(ctx.ranking.status)) return res.status(409).json({ erro: 'Uma competição encerrada não pode ser editada.' });
    const b = req.body || {}; const set = {};
    ['nome', 'descricao', 'imagemUrl', 'regras'].forEach((k) => { if (b[k] !== undefined) set[k] = String(b[k] || '').trim(); });
    if (b.visibilidade !== undefined) set.visibilidade = b.visibilidade === 'publico' ? 'publico' : 'convite';
    if (b.criterioClassificacao !== undefined && ['rentabilidade', 'patrimonio', 'resultado'].includes(b.criterioClassificacao)) set.criterioClassificacao = b.criterioClassificacao;
    if (b.aprovacaoManual !== undefined) set.aprovacaoManual = Boolean(b.aprovacaoManual);
    if (b.maxParticipantes !== undefined) set.maxParticipantes = Math.min(500, Math.max(ctx.ranking.totalParticipantes, Number(b.maxParticipantes)));
    const ranking = await PrivateRanking.findByIdAndUpdate(ctx.ranking._id, { $set: set }, { new: true, runValidators: true });
    return res.json({ ok: true, ranking });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao atualizar competição.' }); }
});

router.post('/:id/posts', async (req, res) => {
  try {
    const ctx = await contexto(req.params.id, req.usuario.id);
    if (!ctx?.participante) return res.status(403).json({ erro: 'Apenas participantes podem publicar no feed.' });
    if (ctx.ranking.status !== 'ativo') return res.status(409).json({ erro: 'O feed está fechado.' });
    const texto = String(req.body?.texto || '').trim();
    if (!texto) return res.status(400).json({ erro: 'Escreva uma mensagem.' });
    const post = await PrivateRankingPost.create({ rankingId: ctx.ranking._id, autorId: req.usuario.id, texto });
    return res.status(201).json({ ok: true, post });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao publicar mensagem.' }); }
});

router.delete('/:id/posts/:postId', async (req, res) => {
  try {
    const ctx = await contexto(req.params.id, req.usuario.id);
    const post = idValido(req.params.postId) ? await PrivateRankingPost.findOne({ _id: req.params.postId, rankingId: req.params.id }) : null;
    if (!ctx || !post) return res.status(404).json({ erro: 'Publicação não encontrada.' });
    if (!ctx.podeGerir && String(post.autorId) !== String(req.usuario.id)) return res.status(403).json({ erro: 'Sem permissão para remover esta publicação.' });
    post.status = 'removido'; post.removidoPor = req.usuario.id; post.removidoEm = new Date(); await post.save();
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao remover publicação.' }); }
});

router.patch('/:id/membros/:usuarioId', async (req, res) => {
  try {
    const ctx = await contexto(req.params.id, req.usuario.id);
    if (!ctx?.podeGerir) return res.status(403).json({ erro: 'Sem permissão para gerenciar participantes.' });
    if (String(ctx.ranking.criadorId) === String(req.params.usuarioId)) return res.status(409).json({ erro: 'O proprietário não pode ser alterado.' });
    const membro = await PrivateRankingMember.findOne({ rankingId: ctx.ranking._id, usuarioId: req.params.usuarioId });
    if (!membro) return res.status(404).json({ erro: 'Participante não encontrado.' });
    const acao = req.body?.acao;
    if (acao === 'aprovar') { const limite = await validarLimiteParticipacao(membro.usuarioId, ctx.ranking._id); if (limite.erro) return res.status(limite.status).json(limite); membro.status = 'aprovado'; membro.aprovadoEm = new Date(); membro.aprovadoPor = req.usuario.id; }
    else if (acao === 'administrador' && ctx.papel === 'proprietario') membro.papel = 'administrador';
    else if (acao === 'participante' && ctx.papel === 'proprietario') membro.papel = 'participante';
    else if (acao === 'remover') { membro.status = 'removido'; membro.removidoEm = new Date(); membro.removidoPor = req.usuario.id; }
    else if (acao === 'bloquear') { membro.status = 'bloqueado'; membro.removidoEm = new Date(); membro.removidoPor = req.usuario.id; }
    else return res.status(400).json({ erro: 'Ação inválida ou não autorizada.' });
    await membro.save();
    const total = await PrivateRankingMember.countDocuments({ rankingId: ctx.ranking._id, status: 'aprovado' });
    await PrivateRanking.updateOne({ _id: ctx.ranking._id }, { $set: { totalParticipantes: total } });
    return res.json({ ok: true, membro });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao gerenciar participante.' }); }
});

router.post('/:id/encerrar', async (req, res) => {
  try {
    const ctx = await contexto(req.params.id, req.usuario.id);
    if (!ctx || ctx.papel !== 'proprietario') return res.status(403).json({ erro: 'Apenas o proprietário pode encerrar.' });
    if (ctx.ranking.status !== 'ativo') return res.status(409).json({ erro: 'A competição não está ativa.' });
    const classificacao = await calcularClassificacao(ctx.ranking); const campeao = classificacao[0] || null;
    if (campeao) await PrivateRankingMember.updateOne({ rankingId: ctx.ranking._id, usuarioId: campeao.usuarioId }, { $push: { trofeus: { tipo: 'campeao', titulo: `Campeão — ${ctx.ranking.nome}`, temporadaId: ctx.ranking.temporadaId, concedidoEm: new Date() } } });
    const temporada = await RankingSeason.findById(ctx.ranking.temporadaId);
    const trofeusPodio = temporada
      ? await concederTrofeusPeriodo({
          temporada,
          periodoTipo: 'temporada',
          periodoChave: temporada.codigo || String(temporada._id),
          apenasRankingPrivadoId: ctx.ranking._id,
          incluirGlobais: false,
          concedidoEm: new Date(),
        })
      : null;
    const ranking = await PrivateRanking.findByIdAndUpdate(ctx.ranking._id, { $set: { status: 'encerrado', encerradoEm: new Date(), dataFim: ctx.ranking.dataFim || new Date(), campeaoUsuarioId: campeao?.usuarioId || null, resultadoFinal: { classificacao, trofeu: 'Campeão' } } }, { new: true });
    return res.json({ ok: true, ranking, campeao, trofeusPodio });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao encerrar competição.' }); }
});

router.post('/:id/arquivar', async (req, res) => {
  try {
    const ctx = await contexto(req.params.id, req.usuario.id);
    if (!ctx || ctx.papel !== 'proprietario') return res.status(403).json({ erro: 'Apenas o proprietário pode arquivar.' });
    if (ctx.ranking.status !== 'encerrado') return res.status(409).json({ erro: 'Encerre a competição antes de arquivá-la.' });
    const ranking = await PrivateRanking.findByIdAndUpdate(ctx.ranking._id, { $set: { status: 'arquivado', arquivadoEm: new Date() } }, { new: true });
    return res.json({ ok: true, ranking });
  } catch (err) { return res.status(500).json({ erro: 'Erro ao arquivar competição.' }); }
});

module.exports = router;

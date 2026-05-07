// controllers/MercadoSecundarioController.js
const mongoose = require('mongoose');

const antifraude = require('../utils/antifraude');
const User = require('../models/User');
const Club = require('../models/Club');
const Order = require('../models/Order');
const Investment = require('../models/Investment');

const MAKER_FEE = 0.002;
const TAKER_FEE = 0.005;
const TICK_SIZE = 0.05;

function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}

function validaTick(preco) {
  const ticks = Math.round(Number(preco) / TICK_SIZE);
  return Math.abs(Number(preco) - ticks * TICK_SIZE) < 0.000001;
}

function getCarteiraIndex(usuario, clubeLegacyId) {
  usuario.carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];
  return usuario.carteira.findIndex((a) => Number(a.clubeId) === Number(clubeLegacyId));
}

function getCarteiraAtivo(usuario, clubeLegacyId) {
  const idx = getCarteiraIndex(usuario, clubeLegacyId);
  return idx >= 0 ? usuario.carteira[idx] : null;
}

function creditaCompra(usuario, clubeLegacyId, nomeClube, quantidade, precoUnitario) {
  usuario.carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];
  const idx = getCarteiraIndex(usuario, clubeLegacyId);

  if (idx === -1) {
    usuario.carteira.push({
      clubeId: Number(clubeLegacyId),
      nomeClube,
      quantidade: Number(quantidade),
      precoMedio: round2(precoUnitario),
      totalInvestido: round2(Number(quantidade) * Number(precoUnitario)),
    });
    return;
  }

  const ativo = usuario.carteira[idx];
  const qtdAtual = Number(ativo.quantidade || 0);
  const totalAtual = round2(ativo.totalInvestido || 0);
  const qtdNova = qtdAtual + Number(quantidade);
  const totalNovo = round2(totalAtual + Number(quantidade) * Number(precoUnitario));

  usuario.carteira[idx] = {
    ...ativo,
    nomeClube,
    quantidade: qtdNova,
    totalInvestido: totalNovo,
    precoMedio: qtdNova > 0 ? round2(totalNovo / qtdNova) : 0,
  };
}

function debitaVenda(usuario, clubeLegacyId, quantidade) {
  usuario.carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];
  const idx = getCarteiraIndex(usuario, clubeLegacyId);
  if (idx === -1) throw new Error('ATIVO_NAO_ENCONTRADO');

  const ativo = usuario.carteira[idx];
  const qtdAtual = Number(ativo.quantidade || 0);
  if (qtdAtual < quantidade) throw new Error('ATIVO_INSUFICIENTE');

  const precoMedio = Number(ativo.precoMedio || 0);
  const qtdNova = qtdAtual - Number(quantidade);

  if (qtdNova <= 0) {
    usuario.carteira.splice(idx, 1);
    return;
  }

  usuario.carteira[idx] = {
    ...ativo,
    quantidade: qtdNova,
    totalInvestido: round2(qtdNova * precoMedio),
  };
}

async function getReservedSellQty({ userId, clubId, session }) {
  const abertas = await Order.find({
    usuarioId: userId,
    clubeId: clubId,
    tipo: 'venda',
    status: { $in: ['aberta', 'parcial'] },
  }).session(session);

  return abertas.reduce((acc, o) => acc + Number(o.restante || 0), 0);
}

function toLivroOrder(o) {
  return {
    id: String(o._id),
    legacyId: o.legacyId || null,
    usuarioId: String(o.usuarioId),
    clubeId: o.clubeLegacyId,
    tipo: o.tipo,
    preco: round2(o.preco),
    quantidade: Number(o.quantidade || 0),
    restante: Number(o.restante || 0),
    aberto: ['aberta', 'parcial'].includes(String(o.status)),
    status: o.status,
    criadoEm: o.criadoEm,
  };
}

async function registrarInvestimento({ session, usuario, clube, quantidade, precoUnitario, totalPago, tipo, metadata = {} }) {
  await Investment.create(
    [
      {
        legacyId: `${tipo.toLowerCase()}_${usuario.legacyId || usuario._id}_${clube.legacyId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        usuarioId: usuario._id,
        usuarioLegacyId: usuario.legacyId ?? null,
        clubeId: clube._id,
        clubeLegacyId: clube.legacyId,
        clubeNome: clube.nome,
        quantidade,
        precoUnitario,
        valorUnitario: precoUnitario,
        totalPago,
        tipo,
        origem: 'SECUNDARIO',
        data: new Date(),
        metadata,
      },
    ],
    { session }
  );
}

async function criarOuCasarOrdem(req, res) {
  const session = await mongoose.startSession();

  try {
    const usuarioId = req.usuario?.id;
    const tipo = String(req.body?.tipo || '').toLowerCase();
    const clubeLegacyId = Number(req.body?.clubeId);
    const quantidade = Number(req.body?.quantidade);
    const preco = Number(req.body?.preco);

    if (!usuarioId) return res.status(401).json({ erro: 'Usuário não autenticado.' });

    const cd = antifraude.evaluateCooldown({ req, userId: usuarioId });
    if (!cd.ok) return res.status(cd.status).json(cd.body);

    const ip = antifraude.getClientIp(req);
    const vUser = antifraude.checkVelocity({ key: `uid:${usuarioId}`, action: 'ORDER_CREATE', limit: 20, windowMs: 60_000 });
    if (!vUser.ok) {
      antifraude.logEvent({ userId: String(usuarioId), ip, action: 'ORDER_CREATE', decision: 'BLOCK', reason: 'rate limit user', retryAfterMs: vUser.retryAfterMs });
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitas ordens em pouco tempo', cooldownMs: vUser.retryAfterMs });
    }

    const vIp = antifraude.checkVelocity({ key: `ip:${ip}`, action: 'ORDER_CREATE', limit: 60, windowMs: 60_000 });
    if (!vIp.ok) {
      antifraude.logEvent({ userId: String(usuarioId), ip, action: 'ORDER_CREATE', decision: 'BLOCK', reason: 'rate limit ip', retryAfterMs: vIp.retryAfterMs });
      return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'muitas ordens (IP) em pouco tempo', cooldownMs: vIp.retryAfterMs });
    }

    if (!['compra', 'venda'].includes(tipo)) return res.status(400).json({ erro: 'Tipo inválido' });
    if (!Number.isInteger(clubeLegacyId) || clubeLegacyId <= 0) return res.status(400).json({ erro: 'clubeId inválido.' });
    if (!Number.isFinite(quantidade) || quantidade <= 0) return res.status(400).json({ erro: 'Quantidade inválida.' });
    if (!Number.isFinite(preco) || preco <= 0 || !validaTick(preco)) return res.status(400).json({ erro: `Preço inválido. Tick mínimo: R$ ${TICK_SIZE.toFixed(2)}` });

    let responseBody = null;

    await session.withTransaction(async () => {
      const usuario = await User.findById(usuarioId).session(session);
      const clube = await Club.findOne({ legacyId: clubeLegacyId }).session(session);

      if (!usuario) throw new Error('USUARIO_NAO_ENCONTRADO');
      if (!clube) throw new Error('CLUBE_NAO_ENCONTRADO');

      if (Number(clube.travadoAte || 0) > Date.now()) {
        const e = new Error('CLUBE_TRAVADO');
        e.cooldownMs = Number(clube.travadoAte) - Date.now();
        throw e;
      }

      if (!clube.ipoEncerrado && Number(clube.cotasDisponiveis || 0) > 0) throw new Error('MERCADO_SECUNDARIO_INATIVO');

      if (tipo === 'venda') {
        const ativo = getCarteiraAtivo(usuario, clubeLegacyId);
        const reservado = await getReservedSellQty({ userId: usuario._id, clubId: clube._id, session });
        const disponivel = Number(ativo?.quantidade || 0) - reservado;
        if (disponivel < quantidade) throw new Error('QUANTIDADE_INDISPONIVEL_VENDA');
      }

      if (tipo === 'compra') {
        const custoMaximo = round2(preco * quantidade * (1 + TAKER_FEE));
        if (round2(usuario.saldo || 0) < custoMaximo) throw new Error('SALDO_INSUFICIENTE');
      }

      const [ordem] = await Order.create(
        [
          {
            legacyId: `ord_${usuario.legacyId || usuario._id}_${clubeLegacyId}_${Date.now()}`,
            usuarioId: usuario._id,
            usuarioLegacyId: usuario.legacyId ?? null,
            clubeId: clube._id,
            clubeLegacyId,
            tipo,
            preco: round2(preco),
            quantidade,
            restante: quantidade,
            status: 'aberta',
            criadoEm: new Date(),
          },
        ],
        { session }
      );

      const matchQuery = tipo === 'compra'
        ? { clubeId: clube._id, tipo: 'venda', status: { $in: ['aberta', 'parcial'] }, preco: { $lte: round2(preco) }, usuarioId: { $ne: usuario._id } }
        : { clubeId: clube._id, tipo: 'compra', status: { $in: ['aberta', 'parcial'] }, preco: { $gte: round2(preco) }, usuarioId: { $ne: usuario._id } };

      const contrapartes = await Order.find(matchQuery)
        .sort(tipo === 'compra' ? { preco: 1, criadoEm: 1 } : { preco: -1, criadoEm: 1 })
        .session(session);

      let preenchido = 0;
      const execucoes = [];
      let ultimoPrecoNegociado = null;

      for (const contraparte of contrapartes) {
        if (Number(ordem.restante || 0) <= 0) break;

        const qtdExec = Math.min(Number(ordem.restante || 0), Number(contraparte.restante || 0));
        if (qtdExec <= 0) continue;

        const buyer = tipo === 'compra' ? usuario : await User.findById(contraparte.usuarioId).session(session);
        const seller = tipo === 'venda' ? usuario : await User.findById(contraparte.usuarioId).session(session);
        if (!buyer || !seller) continue;

        if (String(buyer._id) === String(seller._id)) {
          antifraude.blockSelfTrade?.({ req, userId: usuarioId, clubeId: clubeLegacyId, ordemPassivaId: String(contraparte._id), makerUserId: String(contraparte.usuarioId) });
          continue;
        }

        const precoExec = round2(contraparte.preco);
        const bruto = round2(qtdExec * precoExec);
        const taxaBuyer = round2(bruto * TAKER_FEE);
        const taxaSeller = round2(bruto * MAKER_FEE);
        const custoBuyer = round2(bruto + taxaBuyer);
        const liquidoSeller = round2(bruto - taxaSeller);

        if (round2(buyer.saldo || 0) < custoBuyer) continue;

        debitaVenda(seller, clubeLegacyId, qtdExec);
        seller.saldo = round2(Number(seller.saldo || 0) + liquidoSeller);

        buyer.saldo = round2(Number(buyer.saldo || 0) - custoBuyer);
        creditaCompra(buyer, clubeLegacyId, clube.nome, qtdExec, precoExec);

        ordem.restante = Number(ordem.restante || 0) - qtdExec;
        contraparte.restante = Number(contraparte.restante || 0) - qtdExec;
        ordem.status = Number(ordem.restante || 0) <= 0 ? 'executada' : 'parcial';
        contraparte.status = Number(contraparte.restante || 0) <= 0 ? 'executada' : 'parcial';
        if (ordem.status === 'executada') ordem.executadoEm = new Date();
        if (contraparte.status === 'executada') contraparte.executadoEm = new Date();

        await buyer.save({ session });
        if (String(buyer._id) !== String(seller._id)) await seller.save({ session });
        await contraparte.save({ session });

        await registrarInvestimento({ session, usuario: buyer, clube, quantidade: qtdExec, precoUnitario: precoExec, totalPago: custoBuyer, tipo: 'COMPRA_SECUNDARIO', metadata: { taxa: taxaBuyer, bruto, ordemId: String(ordem._id), contraparteId: String(contraparte._id) } });
        await registrarInvestimento({ session, usuario: seller, clube, quantidade: qtdExec, precoUnitario: precoExec, totalPago: liquidoSeller, tipo: 'VENDA', metadata: { taxa: taxaSeller, bruto, ordemId: String(ordem._id), contraparteId: String(contraparte._id) } });

        preenchido += qtdExec;
        ultimoPrecoNegociado = precoExec;
        execucoes.push({ quantidade: qtdExec, preco: precoExec, bruto, taxaBuyer, taxaSeller });
      }

      if (Number(ordem.restante || 0) <= 0) {
        ordem.restante = 0;
        ordem.status = 'executada';
        ordem.executadoEm = ordem.executadoEm || new Date();
      } else if (preenchido > 0) {
        ordem.status = 'parcial';
      }

      if (ultimoPrecoNegociado != null) {
        const oldPrice = Number(clube.precoAtual || clube.preco || 0);
        const newPrice = round2(ultimoPrecoNegociado);
        const trip = antifraude.shouldTripCircuitBreaker?.({ oldPrice, newPrice, maxPct: 15 });
        if (trip) {
          clube.travadoAte = Date.now() + 180_000;
          antifraude.logEvent({ userId: String(usuarioId), ip, action: 'CIRCUIT_BREAKER_TRIP', decision: 'ALLOW', clubeId: String(clubeLegacyId), oldPrice, newPrice, travadoAte: clube.travadoAte });
        }
        clube.precoAtual = newPrice;
        await clube.save({ session });
      }

      await ordem.save({ session });

      responseBody = {
        ok: true,
        ordem: toLivroOrder(ordem.toObject()),
        preenchido,
        emAberto: Number(ordem.restante || 0),
        execucoes,
        ultimoPreco: ultimoPrecoNegociado,
      };
    });

    return res.json(responseBody);
  } catch (err) {
    console.error('Erro ao criar/casar ordem:', err);

    if (err.message === 'USUARIO_NAO_ENCONTRADO') return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (err.message === 'CLUBE_NAO_ENCONTRADO') return res.status(404).json({ erro: 'Clube não encontrado' });
    if (err.message === 'CLUBE_TRAVADO') return res.status(429).json({ error: 'BLOQUEADO_ANTIFRAUDE', motivo: 'clube temporariamente travado (circuit breaker)', cooldownMs: err.cooldownMs || 180000 });
    if (err.message === 'MERCADO_SECUNDARIO_INATIVO') return res.status(400).json({ erro: 'Mercado secundário ainda não está ativo para este clube (IPO não zerou).' });
    if (err.message === 'QUANTIDADE_INDISPONIVEL_VENDA') return res.status(400).json({ erro: 'Quantidade indisponível para venda' });
    if (err.message === 'SALDO_INSUFICIENTE') return res.status(400).json({ erro: 'Saldo insuficiente' });
    if (err.message === 'ATIVO_NAO_ENCONTRADO' || err.message === 'ATIVO_INSUFICIENTE') return res.status(400).json({ erro: 'Quantidade indisponível para venda' });

    return res.status(500).json({ erro: 'Erro no livro de ordens' });
  } finally {
    await session.endSession();
  }
}

async function getLivro(req, res) {
  try {
    const clubeLegacyId = Number(req.params.clubeId);
    if (!Number.isInteger(clubeLegacyId) || clubeLegacyId <= 0) return res.status(400).json({ erro: 'clubeId inválido.' });

    const ordens = await Order.find({
      clubeLegacyId,
      status: { $in: ['aberta', 'parcial'] },
      restante: { $gt: 0 },
    })
      .sort({ criadoEm: 1 })
      .lean();

    const compras = ordens
      .filter((o) => o.tipo === 'compra')
      .sort((a, b) => Number(b.preco) - Number(a.preco) || new Date(a.criadoEm) - new Date(b.criadoEm))
      .map(toLivroOrder);

    const vendas = ordens
      .filter((o) => o.tipo === 'venda')
      .sort((a, b) => Number(a.preco) - Number(b.preco) || new Date(a.criadoEm) - new Date(b.criadoEm))
      .map(toLivroOrder);

    return res.json({ compras, vendas });
  } catch (err) {
    console.error('Erro ao obter livro:', err);
    return res.status(500).json({ erro: 'Erro ao obter livro de ordens.' });
  }
}

module.exports = { criarOuCasarOrdem, getLivro };
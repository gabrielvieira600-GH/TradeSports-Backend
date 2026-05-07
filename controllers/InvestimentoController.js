// controllers/InvestimentoController.js
const mongoose = require('mongoose');

const User = require('../models/User');
const Club = require('../models/Club');
const Investment = require('../models/Investment');

function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}

function upsertCarteiraAtivo(carteira, { clubeId, nomeClube, quantidade, precoUnitario }) {
  const idx = carteira.findIndex((a) => Number(a.clubeId) === Number(clubeId));

  if (idx === -1) {
    carteira.push({
      clubeId: Number(clubeId),
      nomeClube,
      quantidade: Number(quantidade),
      precoMedio: round2(precoUnitario),
      totalInvestido: round2(Number(quantidade) * Number(precoUnitario)),
    });
    return carteira;
  }

  const atual = carteira[idx];
  const qtdAtual = Number(atual.quantidade || 0);
  const totalAtual = round2(Number(atual.totalInvestido || 0));
  const qtdNova = qtdAtual + Number(quantidade);
  const totalNovo = round2(totalAtual + Number(quantidade) * Number(precoUnitario));
  const precoMedioNovo = qtdNova > 0 ? round2(totalNovo / qtdNova) : 0;

  carteira[idx] = {
    ...atual,
    nomeClube,
    quantidade: qtdNova,
    totalInvestido: totalNovo,
    precoMedio: precoMedioNovo,
  };

  return carteira;
}

async function comprarCota(req, res) {
  const session = await mongoose.startSession();

  try {
    const userId = req.usuario?.id || req.body.usuarioId;
    const legacyClubeId = Number(req.body.clubeId);
    const quantidade = Number(req.body.quantidade || 0);
    const precoInformado = req.body.preco != null ? Number(req.body.preco) : null;

    if (!userId) return res.status(401).json({ erro: 'Usuário não autenticado.' });
    if (!Number.isInteger(legacyClubeId) || legacyClubeId <= 0) return res.status(400).json({ erro: 'clubeId inválido.' });
    if (!Number.isFinite(quantidade) || quantidade <= 0) return res.status(400).json({ erro: 'Quantidade inválida.' });

    let payloadResposta = null;

    await session.withTransaction(async () => {
      const usuario = mongoose.Types.ObjectId.isValid(String(userId))
        ? await User.findById(userId).session(session)
        : await User.findOne({ legacyId: Number(userId) }).session(session);

      if (!usuario) throw new Error('USUARIO_NAO_ENCONTRADO');

      const clube = await Club.findOne({ legacyId: legacyClubeId }).session(session);
      if (!clube) throw new Error('CLUBE_NAO_ENCONTRADO');

      if (clube.ipoEncerrado || Number(clube.cotasDisponiveis || 0) <= 0) throw new Error('IPO_ENCERRADO');
      if (Number(clube.cotasDisponiveis || 0) < quantidade) throw new Error('COTAS_INSUFICIENTES');

      const precoUnitario = round2(
        precoInformado != null && Number.isFinite(precoInformado)
          ? precoInformado
          : clube.precoAtual != null
            ? clube.precoAtual
            : clube.preco
      );

      if (!Number.isFinite(precoUnitario) || precoUnitario <= 0) throw new Error('PRECO_INVALIDO');

      const total = round2(precoUnitario * quantidade);
      const saldoAtual = round2(usuario.saldo || 0);
      if (saldoAtual < total) throw new Error('SALDO_INSUFICIENTE');

      usuario.saldo = round2(saldoAtual - total);
      usuario.carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];
      upsertCarteiraAtivo(usuario.carteira, {
        clubeId: clube.legacyId,
        nomeClube: clube.nome,
        quantidade,
        precoUnitario,
      });

      clube.cotasDisponiveis = Number(clube.cotasDisponiveis || 0) - quantidade;
      clube.cotasEmitidas = Number(clube.cotasEmitidas || 0) + quantidade;
      clube.precoAtual = precoUnitario;

      if (Number(clube.cotasDisponiveis || 0) <= 0) {
        clube.cotasDisponiveis = 0;
        clube.ipoEncerrado = true;
      }

      await usuario.save({ session });
      await clube.save({ session });

      const investimento = await Investment.create(
        [
          {
            legacyId: `ipo_${usuario.legacyId || usuario._id}_${clube.legacyId}_${Date.now()}`,
            usuarioId: usuario._id,
            usuarioLegacyId: usuario.legacyId ?? null,
            clubeId: clube._id,
            clubeLegacyId: clube.legacyId,
            clubeNome: clube.nome,
            quantidade,
            precoUnitario,
            valorUnitario: precoUnitario,
            totalPago: total,
            tipo: 'IPO',
            origem: 'IPO',
            data: new Date(),
            metadata: { modo: 'mongo' },
          },
        ],
        { session }
      );

      payloadResposta = {
        mensagem: 'Compra de IPO realizada com sucesso.',
        investimento: investimento[0],
        usuario: {
          id: String(usuario._id),
          legacyId: usuario.legacyId ?? null,
          nomeUsuario: usuario.nomeUsuario,
          saldo: round2(usuario.saldo),
          carteira: usuario.carteira,
        },
        clube: {
          id: clube.legacyId,
          nome: clube.nome,
          precoAtual: round2(clube.precoAtual),
          cotasDisponiveis: Number(clube.cotasDisponiveis || 0),
          cotasEmitidas: Number(clube.cotasEmitidas || 0),
          ipoEncerrado: Boolean(clube.ipoEncerrado),
        },
      };
    });

    return res.json(payloadResposta);
  } catch (err) {
    console.error('Erro ao comprar cota IPO:', err);

    const mapa = {
      USUARIO_NAO_ENCONTRADO: [404, 'Usuário não encontrado.'],
      CLUBE_NAO_ENCONTRADO: [404, 'Clube não encontrado.'],
      IPO_ENCERRADO: [400, 'IPO encerrado para este clube.'],
      COTAS_INSUFICIENTES: [400, 'Quantidade acima das cotas disponíveis.'],
      SALDO_INSUFICIENTE: [400, 'Saldo insuficiente.'],
      PRECO_INVALIDO: [400, 'Preço inválido.'],
    };

    if (mapa[err.message]) {
      const [status, erro] = mapa[err.message];
      return res.status(status).json({ erro });
    }

    return res.status(500).json({ erro: 'Erro interno ao comprar cota IPO.' });
  } finally {
    await session.endSession();
  }
}

async function listarInvestimentos(req, res) {
  try {
    const { usuarioId, clubeId, tipo, origem, limit = 200 } = req.query || {};
    const filtro = {};

    if (usuarioId) {
      filtro.$or = mongoose.Types.ObjectId.isValid(String(usuarioId))
        ? [{ usuarioId }, { usuarioLegacyId: Number(usuarioId) }]
        : [{ usuarioLegacyId: Number(usuarioId) }];
    }

    if (clubeId) filtro.clubeLegacyId = Number(clubeId);
    if (tipo) filtro.tipo = String(tipo).toUpperCase();
    if (origem) filtro.origem = String(origem).toUpperCase();

    const investimentos = await Investment.find(filtro)
      .sort({ data: -1, createdAt: -1 })
      .limit(Math.min(Number(limit) || 200, 1000))
      .lean();

    return res.json(investimentos.map((i) => ({
      id: String(i._id),
      legacyId: i.legacyId ?? null,
      usuarioId: i.usuarioId ? String(i.usuarioId) : null,
      usuarioLegacyId: i.usuarioLegacyId ?? null,
      clubeId: i.clubeLegacyId ?? null,
      clubeMongoId: i.clubeId ? String(i.clubeId) : null,
      clubeNome: i.clubeNome || '',
      quantidade: Number(i.quantidade || 0),
      precoUnitario: round2(i.precoUnitario ?? i.valorUnitario ?? 0),
      valorUnitario: round2(i.valorUnitario ?? i.precoUnitario ?? 0),
      totalPago: round2(i.totalPago || 0),
      tipo: i.tipo,
      origem: i.origem || null,
      data: i.data,
      metadata: i.metadata || {},
    })));
  } catch (err) {
    console.error('Erro ao listar investimentos:', err);
    return res.status(500).json({ erro: 'Erro ao listar investimentos.' });
  }
}

module.exports = {
  comprarCota,
  criarInvestimento: comprarCota,
  listarInvestimentos,
  round2,
};
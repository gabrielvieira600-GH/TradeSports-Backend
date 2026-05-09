// controllers/InvestimentoController.js
const mongoose = require('mongoose');

const User = require('../models/User');
const Club = require('../models/Club');
const Investment = require('../models/Investment');

function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}

function criarLegacyId(prefix, usuario, clube) {
  return `${prefix}_${usuario.legacyId || usuario._id}_${clube.legacyId}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function getPrecoClube(clube) {
  const preco =
    clube.precoAtual !== undefined && clube.precoAtual !== null
      ? Number(clube.precoAtual)
      : Number(clube.preco || 0);

  return round2(preco);
}

function normalizarQuantidade(qtd) {
  const n = Number(qtd || 0);
  return Number.isFinite(n) ? n : 0;
}

function atualizarCarteiraCompra(usuario, clube, quantidade, precoUnitario) {
  usuario.carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];

  const idx = usuario.carteira.findIndex(
    (a) => Number(a.clubeId) === Number(clube.legacyId)
  );

  if (idx === -1) {
    usuario.carteira.push({
      clubeId: Number(clube.legacyId),
      nomeClube: clube.nome,
      quantidade: Number(quantidade),
      precoMedio: round2(precoUnitario),
      totalInvestido: round2(Number(quantidade) * Number(precoUnitario)),
    });
  } else {
    const atual = usuario.carteira[idx];

    const qtdAtual = Number(atual.quantidade || 0);
    const totalAtual = Number(atual.totalInvestido || 0);

    const qtdNova = qtdAtual + Number(quantidade);
    const totalNovo = round2(totalAtual + Number(quantidade) * Number(precoUnitario));

    usuario.carteira[idx] = {
      ...atual,
      clubeId: Number(clube.legacyId),
      nomeClube: clube.nome,
      quantidade: qtdNova,
      totalInvestido: totalNovo,
      precoMedio: qtdNova > 0 ? round2(totalNovo / qtdNova) : 0,
    };
  }

  usuario.markModified('carteira');
}

async function comprarCota(req, res) {
  const session = await mongoose.startSession();

  try {
    const userId = req.usuario?.id || req.body.usuarioId;
    const legacyClubeId = Number(req.body.clubeId || req.params.id);
    const quantidade = normalizarQuantidade(req.body.quantidade);
    const precoInformado =
      req.body.preco !== undefined && req.body.preco !== null
        ? Number(req.body.preco)
        : null;

    if (!userId) {
      return res.status(401).json({ erro: 'Usuário não autenticado.' });
    }

    if (!Number.isInteger(legacyClubeId) || legacyClubeId <= 0) {
      return res.status(400).json({ erro: 'clubeId inválido.' });
    }

    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return res.status(400).json({ erro: 'Quantidade inválida.' });
    }

    let resposta;

    await session.withTransaction(async () => {
      const usuario = mongoose.Types.ObjectId.isValid(String(userId))
        ? await User.findById(userId).session(session)
        : await User.findOne({ legacyId: Number(userId) }).session(session);

      if (!usuario) {
        throw new Error('USUARIO_NAO_ENCONTRADO');
      }

      const clube = await Club.findOne({ legacyId: legacyClubeId }).session(session);

      if (!clube) {
        throw new Error('CLUBE_NAO_ENCONTRADO');
      }

      if (Boolean(clube.ipoEncerrado) || Number(clube.cotasDisponiveis || 0) <= 0) {
        throw new Error('IPO_ENCERRADO');
      }

      if (Number(clube.cotasDisponiveis || 0) < quantidade) {
        throw new Error('COTAS_INSUFICIENTES');
      }

      const precoUnitario = round2(
        precoInformado !== null && Number.isFinite(precoInformado)
          ? precoInformado
          : getPrecoClube(clube)
      );

      if (!Number.isFinite(precoUnitario) || precoUnitario <= 0) {
        throw new Error('PRECO_INVALIDO');
      }

      const total = round2(precoUnitario * quantidade);
      const saldoAtual = round2(usuario.saldo || 0);

      if (saldoAtual < total) {
        throw new Error('SALDO_INSUFICIENTE');
      }

      usuario.saldo = round2(saldoAtual - total);

      atualizarCarteiraCompra(usuario, clube, quantidade, precoUnitario);

      clube.cotasDisponiveis = Number(clube.cotasDisponiveis || 0) - quantidade;
      clube.cotasEmitidas = Number(clube.cotasEmitidas || 0) + quantidade;
      clube.precoAtual = precoUnitario;

      if (Number(clube.cotasDisponiveis || 0) <= 0) {
        clube.cotasDisponiveis = 0;
        clube.ipoEncerrado = true;
      }

      await usuario.save({ session });
      await clube.save({ session });

      const [investimento] = await Investment.create(
        [
          {
            legacyId: criarLegacyId('ipo', usuario, clube),
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
            metadata: {
              modo: 'mongo',
              rota: '/clube/:id/comprar',
            },
          },
        ],
        { session }
      );

      resposta = {
        mensagem: 'Compra de IPO realizada com sucesso.',
        investimento,
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

    return res.json(resposta);
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

    return res.status(500).json({
      erro: 'Erro interno ao comprar cota IPO.',
      detalhe: process.env.NODE_ENV === 'production' ? undefined : String(err.message || err),
    });
  } finally {
    await session.endSession();
  }
}

async function listarInvestimentos(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit || 200), 1000);

    const investimentos = await Investment.find({})
      .sort({ data: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json(investimentos);
  } catch (err) {
    console.error('Erro ao listar investimentos:', err);
    return res.status(500).json({ erro: 'Erro ao listar investimentos.' });
  }
}

module.exports = {
  comprarCota,
  criarInvestimento: comprarCota,
  listarInvestimentos,
};
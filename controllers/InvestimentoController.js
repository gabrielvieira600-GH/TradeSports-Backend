// controllers/InvestimentoController.js
const mongoose = require('mongoose');

const User = require('../models/User');
const Club = require('../models/Club');
const Investment = require('../models/Investment');
const { autoFavoritarClubeAoComprar } = require('../utils/watchlistAuto');
const ledger = require('../utils/ledger');
const { mercadoFechadoParaClube } = require('../services/marketAccess');
const { calcularPrecoPorPosicao } = require('../utils/liquidationPrice');
const { getMarketMode } = require('../config/marketMode');
const { ensureLiquidityState } = require('../services/institutionalLiquidity');
const Order = require('../models/Order');
const { assertFreshForClub } = require('../services/liveSportsTable');
const RankingSeason = require('../models/RankingSeason');
const { obterPlanoEfetivo } = require('../utils/planFeatures');
const {
  LIMITE_SEMANAL_LITE_PADRAO,
  reconciliarQuotaComOrdensExecutadas,
  consumirOrdemQuotaSemanal,
} = require('../utils/tradingQuota');

function round2(n) {
  return Number(Number(n || 0).toFixed(2));
}

function criarLegacyId(prefix, usuario, clube) {
  return `${prefix}_${usuario.legacyId || usuario._id}_${clube.legacyId}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function getPrecoClube(clube) {
  // IPO: preço único de compra e recompra, obtido da posição ESPORTIVA atual.
  // Nunca aceitar preço enviado pelo navegador ou usar último trade do secundário.
  const posicao = Number(clube.posicao);
  const total = Number(clube.metadata?.totalParticipantes || 20);
  if (!Number.isInteger(total) || total < 2 || !Number.isInteger(posicao) || posicao < 1 || posicao > total) {
    throw new Error('PRECO_INVALIDO'); // falha fechada se a classificação estiver indisponível
  }
  return calcularPrecoPorPosicao(posicao, total);
}

function validarEstadoIpo(clube, state) {
  // A migração das carteiras legadas e da instituição deve ocorrer ANTES da ativação.
  if (Number(state.institutionHeldIssuedShares || 0) !== 0 ||
      Number(state.issuedShares || 0) !== Number(clube.cotasEmitidas || 0)) {
    throw new Error('IPO_ESTOQUE_INCONSISTENTE');
  }
  if (Number(clube.cotasDisponiveis || 0) + Number(clube.cotasEmitidas || 0) !== Number(state.maxShares || 1000)) {
    throw new Error('IPO_ESTOQUE_INCONSISTENTE');
  }
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

function atualizarCarteiraDevolucao(usuario, clube, quantidade) {
  usuario.carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];

  const idx = usuario.carteira.findIndex(
    (a) => Number(a.clubeId) === Number(clube.legacyId)
  );

  if (idx === -1) {
    throw new Error('COTAS_INSUFICIENTES_DEVOLUCAO');
  }

  const ativo = usuario.carteira[idx];
  const qtdAtual = Number(ativo.quantidade || 0);

  if (qtdAtual < quantidade) {
    throw new Error('COTAS_INSUFICIENTES_DEVOLUCAO');
  }

  const qtdNova = qtdAtual - quantidade;

  if (qtdNova <= 0) {
    usuario.carteira.splice(idx, 1);
  } else {
    const precoMedio = round2(ativo.precoMedio || 0);

    usuario.carteira[idx] = {
      ...ativo,
      clubeId: Number(clube.legacyId),
      nomeClube: clube.nome,
      quantidade: qtdNova,
      precoMedio,
      totalInvestido: round2(qtdNova * precoMedio),
    };
  }

  usuario.markModified('carteira');
}

async function comprarCota(req, res) {
  const session = await mongoose.startSession();

  try {
    const userId = req.usuario?.id;
    const legacyClubeId = Number(req.body.clubeId || req.params.id);
    const quantidade = normalizarQuantidade(req.body.quantidade);

    if (getMarketMode() !== 'IPO') {
      return res.status(409).json({ erro: 'Operação IPO indisponível no modo atual.' });
    }

    if (!userId) {
      return res.status(401).json({ erro: 'Usuário não autenticado.' });
    }

    if (!Number.isInteger(legacyClubeId) || legacyClubeId <= 0) {
      return res.status(400).json({ erro: 'clubeId inválido.' });
    }

    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      return res.status(400).json({ erro: 'Quantidade inválida.' });
    }

    let resposta;
    // Reavalia resultados e posições antes de permitir negociar pelo preço vigente.
    const clubePreflight = await Club.findOne({ legacyId: legacyClubeId }).lean();
    if (clubePreflight) await assertFreshForClub(clubePreflight);

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

      if (await mercadoFechadoParaClube(clube, session)) {
        throw new Error('MERCADO_FECHADO');
      }

      if (Boolean(clube.ipoEncerrado) || Number(clube.cotasDisponiveis || 0) <= 0) {
        throw new Error('IPO_ENCERRADO');
      }

      if (Number(clube.cotasDisponiveis || 0) < quantidade) {
        throw new Error('COTAS_INSUFICIENTES');
      }

      const liquidityState = await ensureLiquidityState(clube, session);
      validarEstadoIpo(clube, liquidityState);

      const precoUnitario = getPrecoClube(clube);
      const precoEsperado = Number(req.body?.precoEsperado);
      if (!Number.isFinite(precoEsperado) || Math.abs(precoEsperado - precoUnitario) > 0.001) {
        throw new Error('PRECO_ATUALIZADO');
      }

      if (!Number.isFinite(precoUnitario) || precoUnitario <= 0) {
        throw new Error('PRECO_INVALIDO');
      }

      const total = round2(precoUnitario * quantidade);
      const saldoAtual = round2(usuario.saldo || 0);

      if (saldoAtual < total) {
        throw new Error('SALDO_INSUFICIENTE');
      }

      // Mesmo limite semanal do secundário: uma COMPRA IPO executada = 1 ordem.
      // Em transação: se qualquer lançamento falhar, a quota volta atrás.
      const temporada = await RankingSeason.findOne({ status: 'ativa' })
        .sort({ iniciadaEm: -1, createdAt: -1 }).session(session);
      if (!temporada) throw new Error('TEMPORADA_NAO_ATIVA');
      if (temporada.mercadoAberto === false) throw new Error('MERCADO_FECHADO');

      const planoIPO = obterPlanoEfetivo(usuario);
      let quotaIPO = null;
      let periodoQuotaIPO = null;
      if (planoIPO === 'lite') {
        const limiteLite = Number(
          temporada.limiteOrdensLiteSemanal ??
          temporada.limiteOrdensLitePorRodada ??
          LIMITE_SEMANAL_LITE_PADRAO
        );
        // Reconcilia execução do secundário + compras anteriores no IPO.
        await reconciliarQuotaComOrdensExecutadas({
          usuario, temporada, session, limiteLite,
        });
        const consumida = await consumirOrdemQuotaSemanal({
          usuario, temporada, session, limiteLite,
        });
        quotaIPO = {
          limite: consumida.limite,
          utilizadas: consumida.utilizadas,
          restantes: consumida.restantes,
          limiteAtingido: consumida.limiteAtingido,
        };
        periodoQuotaIPO = consumida.janela.periodoChave;
      }

      usuario.saldo = round2(saldoAtual - total);
      liquidityState.distributionGross = round2(Number(liquidityState.distributionGross || 0) + total);
      liquidityState.liquidationFund = round2(Number(liquidityState.liquidationFund || 0) + total);

      atualizarCarteiraCompra(usuario, clube, quantidade, precoUnitario);

      autoFavoritarClubeAoComprar(usuario, clube, {
      ligaId: clube.metadata?.ligaId || 'brasileirao-a',
      ligaNome: clube.metadata?.ligaNome || 'Brasileirão Série A',
      criarNotificacao: true,
      });

clube.cotasDisponiveis = Number(clube.cotasDisponiveis || 0) - quantidade;
      clube.cotasEmitidas = Number(clube.cotasEmitidas || 0) + quantidade;
      clube.precoAtual = precoUnitario;

      if (Number(clube.cotasDisponiveis || 0) <= 0) {
        clube.cotasDisponiveis = 0;
        clube.ipoEncerrado = true;
      }

      liquidityState.issuedShares = Number(clube.cotasEmitidas);
      liquidityState.basePositionValue = precoUnitario;
      liquidityState.lastRepricedAt = new Date();
      await liquidityState.save({ session });
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
              quotaLiteContabilizada: planoIPO === 'lite',
              quotaLitePeriodo: periodoQuotaIPO,
            },
          },
        ],
        { session }
      );

      const lancamento = ledger.buildIpoPurchaseEntry({
        userId: usuario._id,
        clubeId: clube.legacyId,
        qty: quantidade,
        price: precoUnitario,
      });

      const journal = await ledger.postJournal({
        ...lancamento,
        idemKey: `ipo-purchase:${investimento._id}`,
        session,
      });

      investimento.metadata = {
        ...(investimento.metadata || {}),
        ledgerEntryId: journal?.entry?.id || null,
      };
      investimento.markModified('metadata');
      await investimento.save({ session });

      resposta = {
        mensagem: 'Compra de IPO executada pelo preço atual da classificação.',
        plano: { tipo: planoIPO, ordensIlimitadas: planoIPO === 'premium' },
        franquiaOrdens: quotaIPO,
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
    if (err?.liveData) return res.status(503).json({ codigo: 'DADOS_ESPORTIVOS_INDISPONIVEIS',
      erro: 'Preço indisponível: não foi possível confirmar a classificação atualizada.' });
    if (err?.message === 'PRECO_ATUALIZADO') return res.status(409).json({ codigo: 'PRECO_ATUALIZADO',
      erro: 'O preço mudou com a classificação. Confira o novo preço e confirme novamente.' });

    if (err?.message === 'LIMITE_SEMANAL_ORDENS_ATINGIDO') {
      return res.status(403).json({
        codigo: 'LIMITE_ORDENS_ATINGIDO',
        erro: 'Você atingiu o limite semanal de ordens do Plano Lite.',
        limite: err.limite,
        utilizadas: err.utilizadas,
        restantes: 0,
        renovaEm: err.renovaEm,
      });
    }

    const mapa = {
      TEMPORADA_NAO_ATIVA: [409, 'Nenhuma temporada ativa para realizar compras IPO.'],
      USUARIO_NAO_ENCONTRADO: [404, 'Usuário não encontrado.'],
      CLUBE_NAO_ENCONTRADO: [404, 'Clube não encontrado.'],
      MERCADO_FECHADO: [409, 'Mercado fechado para esta liga.'],
      IPO_ENCERRADO: [400, 'IPO encerrado para este clube.'],
      COTAS_INSUFICIENTES: [400, 'Quantidade acima das cotas disponíveis.'],
      SALDO_INSUFICIENTE: [400, 'Saldo insuficiente.'],
      PRECO_INVALIDO: [400, 'Preço inválido ou classificação indisponível.'],
      IPO_ESTOQUE_INCONSISTENTE: [409, 'Estoque IPO não reconciliado. Contate o suporte.'],
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

async function devolverCotaIPO(req, res) {
  const session = await mongoose.startSession();

  try {
    const userId = req.usuario?.id;
    const legacyClubeId = Number(req.body.clubeId || req.params.id);
    const quantidade = normalizarQuantidade(req.body.quantidade);

    if (getMarketMode() !== 'IPO') {
      return res.status(409).json({ erro: 'Operação IPO indisponível no modo atual.' });
    }

    if (!userId) {
      return res.status(401).json({ erro: 'Usuário não autenticado.' });
    }

    if (!Number.isInteger(legacyClubeId) || legacyClubeId <= 0) {
      return res.status(400).json({ erro: 'clubeId inválido.' });
    }

    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      return res.status(400).json({ erro: 'Quantidade inválida.' });
    }

    let resposta;
    // Reavalia resultados e posições antes de permitir negociar pelo preço vigente.
    const clubePreflight = await Club.findOne({ legacyId: legacyClubeId }).lean();
    if (clubePreflight) await assertFreshForClub(clubePreflight);

    await session.withTransaction(async () => {
      const usuario = await User.findById(userId).session(session);

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

      // Ordens secundárias antigas abertas precisam ser canceladas antes da recompra IPO.
      const existemOrdensAbertas = await Order.exists({
        usuarioId: usuario._id, clubeId: clube._id,
        tipo: 'venda', status: { $in: ['aberta', 'parcial'] }, restante: { $gt: 0 },
      }).session(session);
      if (existemOrdensAbertas) throw new Error('ORDENS_ABERTAS_CONFLITANTES');

      if (Number(clube.cotasEmitidas || 0) < quantidade) {
        throw new Error('COTAS_INSUFICIENTES_DEVOLUCAO');
      }

      const liquidityState = await ensureLiquidityState(clube, session);
      validarEstadoIpo(clube, liquidityState);

      const precoUnitario = getPrecoClube(clube);
      const precoEsperado = Number(req.body?.precoEsperado);
      if (!Number.isFinite(precoEsperado) || Math.abs(precoEsperado - precoUnitario) > 0.001) {
        throw new Error('PRECO_ATUALIZADO');
      }

      if (!Number.isFinite(precoUnitario) || precoUnitario <= 0) {
        throw new Error('PRECO_INVALIDO');
      }

      // A venda ao sistema também é uma ordem executada e compartilha a franquia Lite.
      const temporadaIPO = await RankingSeason.findOne({ status: 'ativa' })
        .sort({ iniciadaEm: -1, createdAt: -1 }).session(session);
      if (!temporadaIPO) throw new Error('TEMPORADA_NAO_ATIVA');
      if (temporadaIPO.mercadoAberto === false) throw new Error('MERCADO_FECHADO');
      const planoIPO = obterPlanoEfetivo(usuario);
      let quotaIPO = null;
      let periodoQuotaIPO = null;
      if (planoIPO === 'lite') {
        const limiteLite = Number(temporadaIPO.limiteOrdensLiteSemanal ?? temporadaIPO.limiteOrdensLitePorRodada ?? LIMITE_SEMANAL_LITE_PADRAO);
        await reconciliarQuotaComOrdensExecutadas({ usuario, temporada: temporadaIPO, session, limiteLite });
        const consumida = await consumirOrdemQuotaSemanal({ usuario, temporada: temporadaIPO, session, limiteLite });
        quotaIPO = { limite: consumida.limite, utilizadas: consumida.utilizadas,
          restantes: consumida.restantes, limiteAtingido: consumida.limiteAtingido };
        periodoQuotaIPO = consumida.janela.periodoChave;
      }

      atualizarCarteiraDevolucao(usuario, clube, quantidade);

      const total = round2(precoUnitario * quantidade);
      usuario.saldo = round2(Number(usuario.saldo || 0) + total);
      liquidityState.buybackGross = round2(Number(liquidityState.buybackGross || 0) + total);
      liquidityState.liquidationFund = round2(Number(liquidityState.liquidationFund || 0) - total);

      clube.cotasDisponiveis = Number(clube.cotasDisponiveis || 0) + quantidade;
      clube.cotasEmitidas = Number(clube.cotasEmitidas || 0) - quantidade;
      clube.precoAtual = precoUnitario;

      liquidityState.issuedShares = Number(clube.cotasEmitidas);
      liquidityState.basePositionValue = precoUnitario;
      liquidityState.lastRepricedAt = new Date();
      await liquidityState.save({ session });
      await usuario.save({ session });
      await clube.save({ session });

      const [investimento] = await Investment.create(
        [
          {
            legacyId: criarLegacyId('ipo_return', usuario, clube),
            usuarioId: usuario._id,
            usuarioLegacyId: usuario.legacyId ?? null,
            clubeId: clube._id,
            clubeLegacyId: clube.legacyId,
            clubeNome: clube.nome,
            quantidade,
            precoUnitario,
            valorUnitario: precoUnitario,
            totalPago: total,
            tipo: 'IPO_RETURN',
            origem: 'IPO',
            data: new Date(),
            metadata: {
              modo: 'mongo',
              rota: '/clube/:id/devolver',
              fee: 0,
              taxa: 0,
              operacao: 'DEVOLUCAO_IPO',
              quotaLiteContabilizada: planoIPO === 'lite',
              quotaLitePeriodo: periodoQuotaIPO,
            },
          },
        ],
        { session }
      );

      const lancamento = ledger.buildIpoReturnEntry({
        userId: usuario._id,
        clubeId: clube.legacyId,
        qty: quantidade,
        price: precoUnitario,
      });

      const journal = await ledger.postJournal({
        ...lancamento,
        idemKey: `ipo-return:${investimento._id}`,
        session,
      });

      investimento.metadata = {
        ...(investimento.metadata || {}),
        ledgerEntryId: journal?.entry?.id || null,
      };
      investimento.markModified('metadata');
      await investimento.save({ session });

      resposta = {
        mensagem: 'Venda ao sistema executada pelo preço atual da classificação.',
        plano: { tipo: planoIPO, ordensIlimitadas: planoIPO === 'premium' },
        franquiaOrdens: quotaIPO,
        tipo: 'IPO_RETURN',
        taxa: 0,
        valorBruto: total,
        valorLiquido: total,
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
          preco: precoUnitario,
          precoAtual: precoUnitario,
          cotasDisponiveis: Number(clube.cotasDisponiveis || 0),
          cotasEmitidas: Number(clube.cotasEmitidas || 0),
          ipoEncerrado: Boolean(clube.ipoEncerrado),
        },
      };
    });

    return res.json(resposta);
  } catch (err) {
    console.error('Erro ao devolver cotas ao IPO:', err);
    if (err?.message === 'LIMITE_SEMANAL_ORDENS_ATINGIDO') {
      return res.status(403).json({ codigo: 'LIMITE_ORDENS_ATINGIDO',
        erro: 'Você atingiu o limite semanal de ordens do Plano Lite.',
        limite: err.limite, utilizadas: err.utilizadas, restantes: 0, renovaEm: err.renovaEm });
    }
    if (err?.liveData) return res.status(503).json({ codigo: 'DADOS_ESPORTIVOS_INDISPONIVEIS',
      erro: 'Preço indisponível: não foi possível confirmar a classificação atualizada.' });
    const mapa = {
      PRECO_ATUALIZADO: [409, 'O preço mudou com a classificação. Confira o novo preço e confirme novamente.'],
      TEMPORADA_NAO_ATIVA: [409, 'Nenhuma temporada ativa para vender cotas IPO.'],
      MERCADO_FECHADO: [409, 'Mercado fechado para negociação.'],
      USUARIO_NAO_ENCONTRADO: [404, 'Usuário não encontrado.'],
      CLUBE_NAO_ENCONTRADO: [404, 'Clube não encontrado.'],
      IPO_ENCERRADO: [400, 'O IPO deste clube já foi encerrado.'],
      COTAS_INSUFICIENTES_DEVOLUCAO: [
        400,
        'Você não possui cotas suficientes para vender ao sistema.',
      ],
      PRECO_INVALIDO: [400, 'Preço oficial indisponível: classificação inválida.'],
      IPO_ESTOQUE_INCONSISTENTE: [409, 'Estoque IPO não reconciliado. Contate o suporte.'],
      ORDENS_ABERTAS_CONFLITANTES: [409, 'Cancele suas ordens de venda abertas antes de devolver cotas ao IPO.'],
    };

    if (mapa[err.message]) {
      const [status, erro] = mapa[err.message];
      return res.status(status).json({ erro });
    }

    return res.status(500).json({
      erro: 'Erro interno ao devolver cotas ao IPO.',
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
  devolverCotaIPO,
  criarInvestimento: comprarCota,
  listarInvestimentos,
};

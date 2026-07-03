// routes/mercado.js
const express = require('express');

const mongoose = require('mongoose');

const router = express.Router();

const auth = require('../middleware/auth');

const User = require('../models/User');

const Club = require('../models/Club');

const Order = require('../models/Order');

const Investment = require('../models/Investment');

const RankingSeason = require('../models/RankingSeason');

const RankingRound = require('../models/RankingRound');

const UserRoundUsage = require('../models/UserRoundUsage');

const {
  obterPlanoEfetivo,
} = require('../utils/planFeatures');

const { autoFavoritarClubeAoComprar } = require('../utils/watchlistAuto');

const MAKER_FEE = 0.002; // 0.20%

const TAKER_FEE = 0.005; // 0.50%

const TICK_SIZE = 0.05;

function round2(n) {

  return Number(Number(n || 0).toFixed(2));

}

function validaTick(preco) {

  const ticks = Math.round(Number(preco) / TICK_SIZE);

  return Math.abs(Number(preco) - ticks * TICK_SIZE) < 0.000001;

}

function getCarteiraAtivo(usuario, clubeLegacyId) {

  usuario.carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];

  return usuario.carteira.find((a) => Number(a.clubeId) === Number(clubeLegacyId));

}

function getCarteiraIndex(usuario, clubeLegacyId) {

  usuario.carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];

  return usuario.carteira.findIndex((a) => Number(a.clubeId) === Number(clubeLegacyId));

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

  const precoMedioNovo = qtdNova > 0 ? round2(totalNovo / qtdNova) : 0;

  usuario.carteira[idx] = {

    ...ativo,

    nomeClube,

    quantidade: qtdNova,

    totalInvestido: totalNovo,

    precoMedio: precoMedioNovo,

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

  const qtdNova = qtdAtual - quantidade;

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

async function criarRegistroInvestment({

  session,

  usuario,

  clube,

  quantidade,

  precoUnitario,

  totalPago,

  tipo,

  metadata = {},

}) {

  await Investment.create(

    [

      {

        legacyId: `${tipo.toLowerCase()}${usuario.legacyId || usuario._id}${clube.legacyId}${Date.now()}${Math.random()

          .toString(36)

          .slice(2, 8)}`,

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

router.get('/livro', async (req, res) => {
  try {
    const clubeLegacyId = Number(req.query.clubeId);

    if (!Number.isInteger(clubeLegacyId) || clubeLegacyId <= 0) {
      return res.status(400).json({ erro: 'clubeId inválido.' });
    }

    const clube = await Club.findOne({ legacyId: clubeLegacyId }).lean();

    if (!clube) {
      return res.status(404).json({ erro: 'Clube não encontrado.' });
    }

    const ordens = await Order.find({
      clubeLegacyId,
      status: { $in: ['aberta', 'parcial'] },
      restante: { $gt: 0 },
    })
      .sort({ tipo: 1, preco: 1, criadoEm: 1 })
      .lean();

    const compras = ordens
      .filter((o) => o.tipo === 'compra')
      .sort(
        (a, b) =>
          Number(b.preco) - Number(a.preco) ||
          new Date(a.criadoEm) - new Date(b.criadoEm)
      )
      .map((o) => ({
        id: String(o._id),
        usuarioId: String(o.usuarioId),
        clubeId: o.clubeLegacyId,
        tipo: o.tipo,
        preco: round2(o.preco),
        quantidade: Number(o.quantidade || 0),
        restante: Number(o.restante || 0),
        status: o.status,
        criadoEm: o.criadoEm,
      }));

    const vendas = ordens
      .filter((o) => o.tipo === 'venda')
      .sort(
        (a, b) =>
          Number(a.preco) - Number(b.preco) ||
          new Date(a.criadoEm) - new Date(b.criadoEm)
      )
      .map((o) => ({
        id: String(o._id),
        usuarioId: String(o.usuarioId),
        clubeId: o.clubeLegacyId,
        tipo: o.tipo,
        preco: round2(o.preco),
        quantidade: Number(o.quantidade || 0),
        restante: Number(o.restante || 0),
        status: o.status,
        criadoEm: o.criadoEm,
      }));

    return res.json({
      clube: {
        id: clube.legacyId,
        nome: clube.nome,
        precoAtual: round2(clube.precoAtual != null ? clube.precoAtual : clube.preco),
        ipoEncerrado: Boolean(clube.ipoEncerrado),
      },

      compras,
      vendas,

      // compatibilidade com componentes antigos
      compra: compras,
      venda: vendas,

      melhorCompra: compras.length ? round2(compras[0].preco) : null,
      melhorVenda: vendas.length ? round2(vendas[0].preco) : null,
      ultimoPreco: round2(clube.precoAtual != null ? clube.precoAtual : clube.preco),
    });
  } catch (err) {
    console.error('Erro ao carregar livro de ordens:', err);
    return res.status(500).json({ erro: 'Erro ao carregar livro de ordens.' });
  }
});

router.get('/livro/:clubeId', async (req, res) => {

  try {

    const clubeLegacyId = Number(req.params.clubeId);

    const clube = await Club.findOne({ legacyId: clubeLegacyId }).lean();

    if (!clube) {

      return res.status(404).json({ erro: 'Clube não encontrado.' });

    }

    const ordens = await Order.find({

      clubeLegacyId,

      status: { $in: ['aberta', 'parcial'] },

    })

      .sort({ tipo: 1, preco: 1, criadoEm: 1 })

      .lean();

    const compras = ordens

      .filter((o) => o.tipo === 'compra')

      .sort((a, b) => Number(b.preco) - Number(a.preco) || new Date(a.criadoEm) - new Date(b.criadoEm))

      .map((o) => ({

        id: String(o._id),

        usuarioId: String(o.usuarioId),

        clubeId: o.clubeLegacyId,

        tipo: o.tipo,

        preco: round2(o.preco),

        quantidade: Number(o.quantidade || 0),

        restante: Number(o.restante || 0),

        status: o.status,

        criadoEm: o.criadoEm,

      }));

    const vendas = ordens

      .filter((o) => o.tipo === 'venda')

      .sort((a, b) => Number(a.preco) - Number(b.preco) || new Date(a.criadoEm) - new Date(b.criadoEm))

      .map((o) => ({

        id: String(o._id),

        usuarioId: String(o.usuarioId),

        clubeId: o.clubeLegacyId,

        tipo: o.tipo,

        preco: round2(o.preco),

        quantidade: Number(o.quantidade || 0),

        restante: Number(o.restante || 0),

        status: o.status,

        criadoEm: o.criadoEm,

      }));

    return res.json({

      clube: {

        id: clube.legacyId,

        nome: clube.nome,

        precoAtual: round2(clube.precoAtual != null ? clube.precoAtual : clube.preco),

        ipoEncerrado: Boolean(clube.ipoEncerrado),

      },

      compras,

      vendas,

      melhorCompra: compras.length ? round2(compras[0].preco) : null,

      melhorVenda: vendas.length ? round2(vendas[0].preco) : null,

      ultimoPreco: round2(clube.precoAtual != null ? clube.precoAtual : clube.preco),

    });

  } catch (err) {

    console.error('Erro ao carregar livro de ordens:', err);

    return res.status(500).json({ erro: 'Erro ao carregar livro de ordens.' });

  }

});

router.get('/minhas-ordens', auth, async (req, res) => {

  try {

    const ordens = await Order.find({

      usuarioId: req.usuario.id,

      status: { $in: ['aberta', 'parcial', 'executada', 'cancelada'] },

    })

      .sort({ criadoEm: -1 })

      .lean();

    return res.json(

      ordens.map((o) => ({

        id: String(o._id),

        clubeId: o.clubeLegacyId,

        tipo: o.tipo,

        preco: round2(o.preco),

        quantidade: Number(o.quantidade || 0),

        restante: Number(o.restante || 0),

        status: o.status,

        criadoEm: o.criadoEm,

        canceladoEm: o.canceladoEm,

        executadoEm: o.executadoEm,

      }))

    );

  } catch (err) {

    console.error('Erro ao listar minhas ordens:', err);

    return res.status(500).json({ erro: 'Erro ao listar ordens.' });

  }

});

router.get(
  '/limite-ordens',
  auth,
  async (req, res) => {
    try {
      const usuario = await User.findById(
        req.usuario.id
      )
        .select(
          [
            '_id',
            'plano',
            'premiumAtivo',
            'premiumInicio',
            'premiumFim',
          ].join(' ')
        )
        .lean();

      if (!usuario) {
        return res.status(404).json({
          erro: 'Usuário não encontrado.',
        });
      }

      const planoEfetivo =
        obterPlanoEfetivo(usuario);

      const temporada =
        await RankingSeason.findOne({
          status: 'ativa',
        })
          .sort({
            iniciadaEm: -1,
            createdAt: -1,
          })
          .lean();

      if (!temporada) {
        return res.json({
          temporadaAtiva: false,
          rodadaAberta: false,

          temporada: null,
          rodada: null,

          plano: planoEfetivo,

          ordensIlimitadas:
            planoEfetivo === 'premium',

          limite:
            planoEfetivo === 'lite'
              ? 15
              : null,

          utilizadas:
            planoEfetivo === 'lite'
              ? 0
              : null,

          restantes:
            planoEfetivo === 'lite'
              ? 15
              : null,

          limiteAtingido: false,
        });
      }

      const rodada =
        await RankingRound.findOne({
          temporadaId: temporada._id,
          status: 'aberta',
        })
          .sort({
            numero: -1,
          })
          .lean();

      const limiteOrdensLite = Number(
        rodada?.limiteOrdensLite ??
          temporada
            .limiteOrdensLitePorRodada ??
          15
      );

      if (!rodada) {
        return res.json({
          temporadaAtiva: true,
          rodadaAberta: false,

          temporada: {
            id: String(temporada._id),
            codigo: temporada.codigo,
            nome: temporada.nome,
          },

          rodada: null,

          plano: planoEfetivo,

          ordensIlimitadas:
            planoEfetivo === 'premium',

          limite:
            planoEfetivo === 'lite'
              ? limiteOrdensLite
              : null,

          utilizadas:
            planoEfetivo === 'lite'
              ? 0
              : null,

          restantes:
            planoEfetivo === 'lite'
              ? limiteOrdensLite
              : null,

          limiteAtingido: false,
        });
      }

      if (planoEfetivo === 'premium') {
        return res.json({
          temporadaAtiva: true,
          rodadaAberta: true,

          temporada: {
            id: String(temporada._id),
            codigo: temporada.codigo,
            nome: temporada.nome,
          },

          rodada: {
            id: String(rodada._id),
            numero: rodada.numero,
            nome: rodada.nome || '',
            abertaEm:
              rodada.abertaEm || null,
            fimPrevisto:
              rodada.fimPrevisto || null,
          },

          plano: 'premium',

          ordensIlimitadas: true,

          limite: null,
          utilizadas: null,
          restantes: null,

          limiteAtingido: false,
        });
      }

      const uso =
        await UserRoundUsage.findOne({
          usuarioId: usuario._id,
          temporadaId: temporada._id,
          rodadaId: rodada._id,
        }).lean();

      const utilizadas = Math.max(
        0,
        Number(
          uso?.ordensUtilizadas || 0
        )
      );

      const limiteRegistrado =
        uso?.limiteOrdens != null
          ? Number(uso.limiteOrdens)
          : limiteOrdensLite;

      const restantes = Math.max(
        0,
        limiteRegistrado -
          utilizadas
      );

      return res.json({
        temporadaAtiva: true,
        rodadaAberta: true,

        temporada: {
          id: String(temporada._id),
          codigo: temporada.codigo,
          nome: temporada.nome,
        },

        rodada: {
          id: String(rodada._id),
          numero: rodada.numero,
          nome: rodada.nome || '',
          abertaEm:
            rodada.abertaEm || null,
          fimPrevisto:
            rodada.fimPrevisto || null,
        },

        plano: 'lite',

        ordensIlimitadas: false,

        limite: limiteRegistrado,

        utilizadas,

        restantes,

        limiteAtingido:
          restantes <= 0,

        primeiraOrdemEm:
          uso?.primeiraOrdemEm || null,

        ultimaOrdemEm:
          uso?.ultimaOrdemEm || null,

        limiteAtingidoEm:
          uso?.limiteAtingidoEm || null,
      });
    } catch (err) {
      console.error(
        'Erro ao consultar limite de ordens:',
        err
      );

      return res.status(500).json({
        erro:
          'Erro interno ao consultar limite de ordens.',
      });
    }
  }
);

router.post('/ordem', auth, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const clubeLegacyId = Number(req.body.clubeId);

    const tipo = String(
      req.body.tipo || ''
    ).toLowerCase();

    const preco = Number(req.body.preco);

    const quantidade = Number(
      req.body.quantidade
    );

    if (!['compra', 'venda'].includes(tipo)) {
      return res.status(400).json({
        erro: 'Tipo de ordem inválido.',
      });
    }

    if (
      !Number.isInteger(clubeLegacyId) ||
      clubeLegacyId <= 0
    ) {
      return res.status(400).json({
        erro: 'clubeId inválido.',
      });
    }

    if (
      !Number.isFinite(preco) ||
      preco <= 0 ||
      !validaTick(preco)
    ) {
      return res.status(400).json({
        erro:
          `Preço inválido. Tick mínimo: R$ ${TICK_SIZE.toFixed(2)}`,
      });
    }

    if (
      !Number.isFinite(quantidade) ||
      quantidade <= 0
    ) {
      return res.status(400).json({
        erro: 'Quantidade inválida.',
      });
    }

    let resposta = null;

    await session.withTransaction(async () => {
      const usuario = await User.findById(
        req.usuario.id
      ).session(session);

      const clube = await Club.findOne({
        legacyId: clubeLegacyId,
      }).session(session);

      if (!usuario) {
        throw new Error(
          'USUARIO_NAO_ENCONTRADO'
        );
      }

      if (!clube) {
        throw new Error(
          'CLUBE_NAO_ENCONTRADO'
        );
      }

      if (!Boolean(clube.ipoEncerrado)) {
        throw new Error(
          'IPO_AINDA_ABERTO'
        );
      }

      usuario.carteira = Array.isArray(
        usuario.carteira
      )
        ? usuario.carteira
        : [];

      /*
       * Primeiro validamos saldo ou cotas.
       * Uma ordem inválida não deve consumir franquia.
       */
      if (tipo === 'venda') {
        const ativo = getCarteiraAtivo(
          usuario,
          clubeLegacyId
        );

        const reservado =
          await getReservedSellQty({
            userId: usuario._id,
            clubId: clube._id,
            session,
          });

        const disponivel =
          Number(ativo?.quantidade || 0) -
          Number(reservado || 0);

        if (disponivel < quantidade) {
          throw new Error(
            'COTAS_INSUFICIENTES_VENDA'
          );
        }
      }

      if (tipo === 'compra') {
        const custoMaximo = round2(
          preco *
            quantidade *
            (1 + TAKER_FEE)
        );

        if (
          round2(usuario.saldo || 0) <
          custoMaximo
        ) {
          throw new Error(
            'SALDO_INSUFICIENTE'
          );
        }
      }

      /*
       * A ordem só pode ser criada durante
       * uma temporada ativa e uma rodada aberta.
       */
      const temporada =
        await RankingSeason.findOne({
          status: 'ativa',
        })
          .sort({
            iniciadaEm: -1,
            createdAt: -1,
          })
          .session(session);

      if (!temporada) {
        throw new Error(
          'TEMPORADA_NAO_ATIVA'
        );
      }

      const rodada =
        await RankingRound.findOne({
          temporadaId: temporada._id,
          status: 'aberta',
        })
          .sort({
            numero: -1,
          })
          .session(session);

      if (!rodada) {
        throw new Error(
          'RODADA_NAO_ABERTA'
        );
      }

      const planoEfetivo =
        obterPlanoEfetivo(usuario);

      const limiteOrdensLite = Number(
        rodada.limiteOrdensLite ??
          temporada
            .limiteOrdensLitePorRodada ??
          15
      );

      let usoRodada = null;

      /*
       * Premium não possui limite comercial.
       * Lite consome uma unidade por ordem aceita.
       */
      if (planoEfetivo === 'lite') {
        usoRodada =
          await UserRoundUsage.findOne({
            usuarioId: usuario._id,
            temporadaId: temporada._id,
            rodadaId: rodada._id,
          }).session(session);

        const agora = new Date();

        if (!usoRodada) {
          const criados =
            await UserRoundUsage.create(
              [
                {
                  usuarioId: usuario._id,
                  temporadaId:
                    temporada._id,
                  rodadaId: rodada._id,
                  numeroRodada:
                    rodada.numero,
                  planoNoMomento: 'lite',
                  limiteOrdens:
                    limiteOrdensLite,
                  ordensUtilizadas: 1,
                  primeiraOrdemEm: agora,
                  ultimaOrdemEm: agora,
                  limiteAtingidoEm:
                    limiteOrdensLite === 1
                      ? agora
                      : null,
                },
              ],
              {
                session,
              }
            );

          usoRodada = criados[0];
        } else {
          const ordensUtilizadas =
            Number(
              usoRodada.ordensUtilizadas ||
                0
            );

          const limiteRegistrado =
            Number(
              usoRodada.limiteOrdens ||
                limiteOrdensLite
            );

          if (
            ordensUtilizadas >=
            limiteRegistrado
          ) {
            const erroLimite =
              new Error(
                'LIMITE_ORDENS_ATINGIDO'
              );

            erroLimite.limite =
              limiteRegistrado;

            erroLimite.utilizadas =
              ordensUtilizadas;

            erroLimite.rodada =
              rodada.numero;

            erroLimite.temporada =
              temporada.codigo;

            throw erroLimite;
          }

          usoRodada.planoNoMomento =
            'lite';

          usoRodada.numeroRodada =
            rodada.numero;

          usoRodada.limiteOrdens =
            limiteOrdensLite;

          usoRodada.ordensUtilizadas =
            ordensUtilizadas + 1;

          usoRodada.primeiraOrdemEm =
            usoRodada.primeiraOrdemEm ||
            agora;

          usoRodada.ultimaOrdemEm =
            agora;

          if (
            usoRodada.ordensUtilizadas >=
            limiteOrdensLite
          ) {
            usoRodada.limiteAtingidoEm =
              usoRodada
                .limiteAtingidoEm ||
              agora;
          }

          await usoRodada.save({
            session,
          });
        }
      }

      /*
       * A franquia já foi validada dentro
       * da mesma transação.
       *
       * Se a criação da ordem falhar,
       * o consumo também será revertido.
       */
      const [ordem] = await Order.create(
        [
          {
            legacyId:
              `ord_${usuario.legacyId || usuario._id}_${clubeLegacyId}_${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 8)}`,

            usuarioId: usuario._id,

            usuarioLegacyId:
              usuario.legacyId ?? null,

            clubeId: clube._id,

            clubeLegacyId,

            tipo,

            preco: round2(preco),

            quantidade:
              Number(quantidade),

            restante:
              Number(quantidade),

            status: 'aberta',

            criadoEm: new Date(),
          },
        ],
        {
          session,
        }
      );

      const matchQuery =
        tipo === 'compra'
          ? {
              clubeId: clube._id,

              tipo: 'venda',

              status: {
                $in: [
                  'aberta',
                  'parcial',
                ],
              },

              restante: {
                $gt: 0,
              },

              preco: {
                $lte: round2(preco),
              },

              usuarioId: {
                $ne: usuario._id,
              },
            }
          : {
              clubeId: clube._id,

              tipo: 'compra',

              status: {
                $in: [
                  'aberta',
                  'parcial',
                ],
              },

              restante: {
                $gt: 0,
              },

              preco: {
                $gte: round2(preco),
              },

              usuarioId: {
                $ne: usuario._id,
              },
            };

      const contrapartes =
        await Order.find(matchQuery)
          .sort(
            tipo === 'compra'
              ? {
                  preco: 1,
                  criadoEm: 1,
                }
              : {
                  preco: -1,
                  criadoEm: 1,
                }
          )
          .session(session);

      const execucoes = [];

      for (
        const contraparte of
        contrapartes
      ) {
        if (
          Number(
            ordem.restante || 0
          ) <= 0
        ) {
          break;
        }

        const qtdExec = Math.min(
          Number(ordem.restante || 0),
          Number(
            contraparte.restante || 0
          )
        );

        if (qtdExec <= 0) {
          continue;
        }

        const precoExec = round2(
          contraparte.preco
        );

        const buyer =
          tipo === 'compra'
            ? usuario
            : await User.findById(
                contraparte.usuarioId
              ).session(session);

        const seller =
          tipo === 'venda'
            ? usuario
            : await User.findById(
                contraparte.usuarioId
              ).session(session);

        if (!buyer || !seller) {
          continue;
        }

        if (
          String(buyer._id) ===
          String(seller._id)
        ) {
          continue;
        }

        const bruto = round2(
          qtdExec * precoExec
        );

        const taxaBuyer = round2(
          bruto * TAKER_FEE
        );

        const taxaSeller = round2(
          bruto * MAKER_FEE
        );

        const custoBuyer = round2(
          bruto + taxaBuyer
        );

        const creditoSeller = round2(
          bruto - taxaSeller
        );

        if (
          round2(buyer.saldo || 0) <
          custoBuyer
        ) {
          if (tipo === 'compra') {
            break;
          }

          continue;
        }

        try {
          debitaVenda(
            seller,
            clubeLegacyId,
            qtdExec
          );
        } catch (_) {
          continue;
        }

        creditaCompra(
          buyer,
          clubeLegacyId,
          clube.nome,
          qtdExec,
          precoExec
        );

        autoFavoritarClubeAoComprar(
          buyer,
          clube,
          {
            ligaId:
              'brasileirao-a',

            ligaNome:
              'Brasileirão Série A',

            criarNotificacao: true,
          }
        );

        /*
         * Correção:
         * o saldo era alterado duas vezes
         * no arquivo anterior.
         */
        buyer.saldo = round2(
          Number(buyer.saldo || 0) -
            custoBuyer
        );

        seller.saldo = round2(
          Number(seller.saldo || 0) +
            creditoSeller
        );

        buyer.markModified(
          'carteira'
        );

        buyer.markModified(
          'watchlist'
        );

        buyer.markModified(
          'alertState'
        );

        buyer.markModified(
          'notificacoes'
        );

        seller.markModified(
          'carteira'
        );

        ordem.restante =
          Number(
            ordem.restante || 0
          ) - qtdExec;

        contraparte.restante =
          Number(
            contraparte.restante || 0
          ) - qtdExec;

        ordem.status =
          Number(
            ordem.restante || 0
          ) <= 0
            ? 'executada'
            : 'parcial';

        contraparte.status =
          Number(
            contraparte.restante || 0
          ) <= 0
            ? 'executada'
            : 'parcial';

        if (
          ordem.status ===
          'executada'
        ) {
          ordem.executadoEm =
            new Date();
        }

        if (
          contraparte.status ===
          'executada'
        ) {
          contraparte.executadoEm =
            new Date();
        }

        clube.precoAtual =
          precoExec;

        await buyer.save({
          session,
        });

        if (
          String(buyer._id) !==
          String(seller._id)
        ) {
          await seller.save({
            session,
          });
        }

        await ordem.save({
          session,
        });

        await contraparte.save({
          session,
        });

        await clube.save({
          session,
        });

        const buyerOrder =
          tipo === 'compra'
            ? ordem
            : contraparte;

        const sellerOrder =
          tipo === 'venda'
            ? ordem
            : contraparte;

        await criarRegistroInvestment({
          session,
          usuario: buyer,
          clube,
          quantidade: qtdExec,
          precoUnitario: precoExec,
          totalPago: custoBuyer,
          tipo: 'COMPRA',

          metadata: {
            mercado: 'secundario',

            fee: taxaBuyer,

            feeType:
              tipo === 'compra'
                ? 'taker'
                : 'maker',

            orderId: String(
              buyerOrder._id
            ),

            matchedOrderId: String(
              sellerOrder._id
            ),
          },
        });

        await criarRegistroInvestment({
          session,
          usuario: seller,
          clube,
          quantidade: qtdExec,
          precoUnitario: precoExec,
          totalPago: creditoSeller,
          tipo: 'VENDA',

          metadata: {
            mercado: 'secundario',

            fee: taxaSeller,

            feeType:
              tipo === 'venda'
                ? 'taker'
                : 'maker',

            orderId: String(
              sellerOrder._id
            ),

            matchedOrderId: String(
              buyerOrder._id
            ),
          },
        });

        execucoes.push({
          quantidade: qtdExec,
          preco: precoExec,
          bruto,
          taxaBuyer,
          taxaSeller,
        });
      }

      if (
        Number(
          ordem.restante || 0
        ) <= 0
      ) {
        ordem.restante = 0;

        ordem.status = 'executada';

        ordem.executadoEm =
          ordem.executadoEm ||
          new Date();
      } else if (
        execucoes.length > 0
      ) {
        ordem.status = 'parcial';
      } else {
        ordem.status = 'aberta';
      }

      await ordem.save({
        session,
      });

      const ordensUtilizadas =
        planoEfetivo === 'lite'
          ? Number(
              usoRodada
                ?.ordensUtilizadas || 0
            )
          : null;

      const ordensRestantes =
        planoEfetivo === 'lite'
          ? Math.max(
              0,
              limiteOrdensLite -
                ordensUtilizadas
            )
          : null;

      resposta = {
        mensagem:
          execucoes.length
            ? 'Ordem enviada e processada no mercado.'
            : 'Ordem enviada para o livro de ordens.',

        ordem: {
          id: String(ordem._id),

          tipo: ordem.tipo,

          preco: round2(
            ordem.preco
          ),

          quantidade: Number(
            ordem.quantidade || 0
          ),

          restante: Number(
            ordem.restante || 0
          ),

          status: ordem.status,

          clubeId:
            ordem.clubeLegacyId,
        },

        execucoes,

        clube: {
          id: clube.legacyId,

          nome: clube.nome,

          precoAtual: round2(
            clube.precoAtual != null
              ? clube.precoAtual
              : clube.preco
          ),
        },

        temporada: {
          id: String(
            temporada._id
          ),

          codigo:
            temporada.codigo,

          nome:
            temporada.nome,
        },

        rodada: {
          id: String(
            rodada._id
          ),

          numero:
            rodada.numero,

          nome:
            rodada.nome || '',
        },

        plano: {
          tipo: planoEfetivo,

          ordensIlimitadas:
            planoEfetivo ===
            'premium',
        },

        franquiaOrdens: {
          limite:
            planoEfetivo === 'lite'
              ? limiteOrdensLite
              : null,

          utilizadas:
            ordensUtilizadas,

          restantes:
            ordensRestantes,

          limiteAtingido:
            planoEfetivo === 'lite'
              ? ordensRestantes <= 0
              : false,
        },
      };
    });

    return res.json(resposta);
  } catch (err) {
    console.error(
      'Erro ao enviar ordem:',
      err
    );

    if (
      err.message ===
      'USUARIO_NAO_ENCONTRADO'
    ) {
      return res.status(404).json({
        erro:
          'Usuário não encontrado.',
      });
    }

    if (
      err.message ===
      'CLUBE_NAO_ENCONTRADO'
    ) {
      return res.status(404).json({
        erro:
          'Clube não encontrado.',
      });
    }

    if (
      err.message ===
      'IPO_AINDA_ABERTO'
    ) {
      return res.status(400).json({
        erro:
          'Mercado secundário só abre após o fim do IPO.',
      });
    }

    if (
      err.message ===
      'COTAS_INSUFICIENTES_VENDA'
    ) {
      return res.status(400).json({
        erro:
          'Você não possui cotas livres suficientes para vender.',
      });
    }

    if (
      err.message ===
      'SALDO_INSUFICIENTE'
    ) {
      return res.status(400).json({
        erro:
          'Saldo insuficiente para enviar a ordem.',
      });
    }

    if (
      err.message ===
      'TEMPORADA_NAO_ATIVA'
    ) {
      return res.status(409).json({
        erro:
          'Não existe uma temporada ativa no momento.',

        codigo:
          'TEMPORADA_NAO_ATIVA',
      });
    }

    if (
      err.message ===
      'RODADA_NAO_ABERTA'
    ) {
      return res.status(409).json({
        erro:
          'Não existe uma rodada aberta no momento.',

        codigo:
          'RODADA_NAO_ABERTA',
      });
    }

    if (
      err.message ===
      'LIMITE_ORDENS_ATINGIDO'
    ) {
      return res.status(403).json({
        erro:
          'Você atingiu o limite de ordens desta rodada.',

        codigo:
          'LIMITE_ORDENS_ATINGIDO',

        plano: 'lite',

        limite:
          Number(err.limite || 15),

        utilizadas:
          Number(
            err.utilizadas ||
              err.limite ||
              15
          ),

        restantes: 0,

        rodada:
          err.rodada || null,

        temporada:
          err.temporada || null,
      });
    }

    if (err?.code === 11000) {
      return res.status(409).json({
        erro:
          'Não foi possível atualizar o contador de ordens. Tente novamente.',

        codigo:
          'CONFLITO_CONTADOR_ORDENS',
      });
    }

    return res.status(500).json({
      erro:
        'Erro interno ao enviar ordem.',

      detalhe:
        process.env.NODE_ENV ===
        'production'
          ? undefined
          : String(
              err.message || err
            ),
    });
  } finally {
    await session.endSession();
  }
});

router.post('/ordem/cancelar/:id', auth, async (req, res) => {

  try {

    const ordem = await Order.findOne({

      _id: req.params.id,

      usuarioId: req.usuario.id,

      status: { $in: ['aberta', 'parcial'] },

    });

    if (!ordem) {

      return res.status(404).json({ erro: 'Ordem não encontrada ou não cancelável.' });

    }

    ordem.status = 'cancelada';

    ordem.canceladoEm = new Date();

    await ordem.save();

    return res.json({

      mensagem: 'Ordem cancelada com sucesso.',

      ordem: {

        id: String(ordem._id),

        status: ordem.status,

      },

    });

  } catch (err) {

    console.error('Erro ao cancelar ordem:', err);

    return res.status(500).json({ erro: 'Erro ao cancelar ordem.' });

  }

});

module.exports = router;










































































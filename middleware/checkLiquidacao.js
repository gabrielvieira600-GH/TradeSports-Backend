// middleware/checkLiquidacao.js
const Club = require('../models/Club');

const User = require('../models/User');

const Investment = require('../models/Investment');

const Liquidacao = require('../models/Liquidacao');

const { runTx, round2 } = require('../utils/tx');

const ledger = require('../utils/ledger');

function calcularPrecoPorPosicao(posicao) {

  const basePosicao = 20;

  const basePreco20 = 5.0;

  const fatorAumento = 1.05;

  if (!posicao || posicao < 1 || posicao > 20) return basePreco20;

  const passos = basePosicao - posicao;

  const preco = basePreco20 * Math.pow(fatorAumento, passos);

  return Number(preco.toFixed(2));

}

function ajustarPrecoLiquidacaoPorSplit(precoBase, splitFactorCumulativo) {

  const fator = Number(splitFactorCumulativo || 1);

  if (!fator || fator <= 1) return Number(precoBase || 0);

  return Number((Number(precoBase || 0) / fator).toFixed(2));

}

async function liquidarBrasileirao() {

  const clubes = await Club.find({}).lean();

  const usuarios = await User.find({}).lean();

  const mapaClubePorId = {};

  for (const c of clubes) {

    mapaClubePorId[c.legacyId] = c;

  }

  let totalGeral = 0;

  for (const usuario of usuarios) {

    const carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];

    if (!carteira.length) continue;

    for (const ativo of carteira) {

      const clube = mapaClubePorId[ativo.clubeId];

      if (!clube) continue;

      const qtd = Number(ativo.quantidade || 0);

      if (qtd <= 0) continue;

      const splitFactorCumulativo = Number(clube.splitFactorCumulativo || 1);

      const posicaoFinal = Number(clube.posicao || 20);

      const precoLiquidacaoBase = calcularPrecoPorPosicao(posicaoFinal);

      const precoLiquidacao = ajustarPrecoLiquidacaoPorSplit(

        precoLiquidacaoBase,

        splitFactorCumulativo

      );

      const totalRecebido = round2(qtd * precoLiquidacao);

      await runTx({

        action: 'LIQUIDACAO_FINAL',

        meta: {

          usuarioId: String(usuario._id),

          clubeId: clube.legacyId,

          quantidade: qtd,

        },

        mutate: async (session) => {

          const userDoc = await User.findById(usuario._id).session(session);

          const clubDoc = await Club.findById(clube._id).session(session);

          if (!userDoc || !clubDoc) return;

          const saldoAntes = round2(userDoc.saldo || 0);

          userDoc.saldo = round2(saldoAntes + totalRecebido);

          userDoc.carteira = (userDoc.carteira || []).filter(

            (a) => Number(a.clubeId) !== Number(clube.legacyId)

          );

          await userDoc.save({ session });

          const idemKey = `liq:Brasileirao:2026:${String(userDoc._id)}:${clube.legacyId}`;

          const journal = await ledger.postJournal({

            action: 'LIQUIDACAO_FINAL',

            idemKey,

            lines: [

              {

                account: `user:${String(userDoc._id)}`,

                debit: totalRecebido,

                credit: 0,

              },

              {

                account: `passivo.carteira_liquidacao.${clube.legacyId}`,

                debit: 0,

                credit: totalRecebido,

              },

            ],

            meta: {

              campeonato: 'Brasileirao',

              temporada: 2026,

              usuarioId: String(userDoc._id),

              clubeId: clube.legacyId,

              quantidade: qtd,

              valorUnitario: precoLiquidacao,

              valorUnitarioBase: precoLiquidacaoBase,

              splitFactorCumulativo,

              totalPago: totalRecebido,

            },

            session,

          });

          await Investment.create(

            [

              {

                legacyId: `liq_${userDoc.legacyId || userDoc._id}_${clube.legacyId}_${Date.now()}`,

                usuarioId: userDoc._id,

                usuarioLegacyId: userDoc.legacyId ?? null,

                clubeId: clubDoc._id,

                clubeLegacyId: clube.legacyId,

                clubeNome: clube.nome,

                quantidade: qtd,

                precoUnitario: precoLiquidacao,

                valorUnitario: precoLiquidacao,

                totalPago: totalRecebido,

                tipo: 'LIQUIDACAO',

                origem: 'FECHAMENTO_CAMPEONATO',

                data: new Date(),

                metadata: {

                  posicaoFinal,

                  precoLiquidacaoBase,

                  splitFactorCumulativo,

                },

              },

            ],

            { session }

          );

          await Liquidacao.create(

            [

              {

                usuarioId: userDoc._id,

                clubeId: clubDoc._id,

                campeonato: 'Brasileirao',

                temporada: 2026,

                posicaoFinal,

                quantidade: qtd,

                precoLiquidacaoBase,

                splitFactorCumulativo,

                precoLiquidacao,

                totalRecebido,

                saldoAntes,

                saldoDepois: userDoc.saldo,

                quantidadeAntesLiquidacao: qtd,

                quantidadeDepoisLiquidacao: 0,

                ledgerEntryId: journal?.entry?.id || null,

                idemKey,

                status: 'processada',

                meta: {},

                dataLiquidacao: new Date(),

              },

            ],

            { session }

          );

        },

      });

      totalGeral = round2(totalGeral + totalRecebido);

    }

  }

  return { ok: true, totalGeral };

}

function checkLiquidacao(req, res, next) {

  next();

}

module.exports = {

  checkLiquidacao,

  liquidarBrasileirao,

  calcularPrecoPorPosicao,

  ajustarPrecoLiquidacaoPorSplit,

};
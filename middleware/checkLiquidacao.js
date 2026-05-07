// middleware/checkLiquidacao.js
const Club = require('../models/Club');
const User = require('../models/User');
const Investment = require('../models/Investment');
const Liquidacao = require('../models/Liquidacao');
const { runTx, round2 } = require('../utils/tx');
const ledger = require('../utils/ledger');

const CAMPEONATO_PADRAO = process.env.LIQUIDACAO_CAMPEONATO || 'Brasileirao';
const TEMPORADA_PADRAO = Number(process.env.LIQUIDACAO_TEMPORADA || process.env.API_FOOTBALL_SEASON || new Date().getFullYear());

function calcularPrecoPorPosicao(posicao) {
  const basePosicao = 20;
  const basePreco20 = 5.0;
  const fatorAumento = 1.05;
  const pos = Number(posicao || basePosicao);
  if (!pos || pos < 1 || pos > 20) return basePreco20;
  const passos = basePosicao - pos;
  return round2(basePreco20 * Math.pow(fatorAumento, passos));
}

function ajustarPrecoLiquidacaoPorSplit(precoBase, splitFactorCumulativo) {
  const fator = Number(splitFactorCumulativo || 1);
  if (!fator || fator <= 1) return round2(precoBase || 0);
  return round2(Number(precoBase || 0) / fator);
}

async function liquidarBrasileirao(options = {}) {
  const campeonato = options.campeonato || CAMPEONATO_PADRAO;
  const temporada = Number(options.temporada || TEMPORADA_PADRAO);

  const clubes = await Club.find({}).lean();
  const mapaClubePorLegacyId = new Map(clubes.map((c) => [Number(c.legacyId), c]));

  const usuarios = await User.find({ carteira: { $exists: true, $ne: [] } }).lean();

  let totalGeral = 0;
  const resumoUsuarios = [];
  const rankingPorClubeId = {};

  for (const usuario of usuarios) {
    const carteira = Array.isArray(usuario.carteira) ? usuario.carteira : [];
    if (!carteira.length) continue;

    let totalUsuario = 0;
    const liquidacoesUsuario = [];

    for (const ativo of carteira) {
      const clubeLegacyId = Number(ativo.clubeId);
      const clube = mapaClubePorLegacyId.get(clubeLegacyId);
      if (!clube) continue;

      const qtd = Number(ativo.quantidade || 0);
      if (!Number.isFinite(qtd) || qtd <= 0) continue;

      const splitFactorCumulativo = Number(clube.splitFactorCumulativo || 1);
      const posicaoFinal = Number(clube.posicao || 20);
      const precoLiquidacaoBase = calcularPrecoPorPosicao(posicaoFinal);
      const precoLiquidacao = ajustarPrecoLiquidacaoPorSplit(precoLiquidacaoBase, splitFactorCumulativo);
      const totalRecebido = round2(qtd * precoLiquidacao);
      const idemKey = `liq:${campeonato}:${temporada}:${String(usuario._id)}:${clubeLegacyId}`;

      let liquidacaoCriada = null;

      await runTx({
        action: 'LIQUIDACAO_FINAL',
        meta: { usuarioId: String(usuario._id), clubeId: clubeLegacyId, quantidade: qtd, campeonato, temporada },
        mutate: async (session) => {
          const jaProcessada = await Liquidacao.findOne({ idemKey }).session(session).lean();
          if (jaProcessada) {
            liquidacaoCriada = jaProcessada;
            return;
          }

          const userDoc = await User.findById(usuario._id).session(session);
          const clubDoc = await Club.findById(clube._id).session(session);
          if (!userDoc || !clubDoc) return;

          const ativoAtual = (userDoc.carteira || []).find((a) => Number(a.clubeId) === clubeLegacyId);
          const qtdAtual = Number(ativoAtual?.quantidade || 0);
          if (!qtdAtual || qtdAtual <= 0) return;

          const totalAtual = round2(qtdAtual * precoLiquidacao);
          const saldoAntes = round2(userDoc.saldo || 0);
          userDoc.saldo = round2(saldoAntes + totalAtual);
          userDoc.carteira = (userDoc.carteira || []).filter((a) => Number(a.clubeId) !== clubeLegacyId);

          const journal = await ledger.postJournal({
            action: 'LIQUIDACAO_FINAL',
            idemKey,
            lines: [
              { account: `user:${String(userDoc._id)}`, debit: totalAtual, credit: 0 },
              { account: `passivo.carteira_liquidacao.${clubeLegacyId}`, debit: 0, credit: totalAtual },
            ],
            meta: {
              campeonato,
              temporada,
              usuarioId: String(userDoc._id),
              clubeId: clubeLegacyId,
              quantidade: qtdAtual,
              valorUnitario: precoLiquidacao,
              valorUnitarioBase: precoLiquidacaoBase,
              splitFactorCumulativo,
              totalPago: totalAtual,
            },
            session,
          });

          await userDoc.save({ session });

          await Investment.create(
            [
              {
                legacyId: `liq_${userDoc.legacyId || userDoc._id}_${clubeLegacyId}_${Date.now()}`,
                usuarioId: userDoc._id,
                usuarioLegacyId: userDoc.legacyId ?? null,
                clubeId: clubDoc._id,
                clubeLegacyId,
                clubeNome: clube.nome,
                quantidade: qtdAtual,
                precoUnitario: precoLiquidacao,
                valorUnitario: precoLiquidacao,
                totalPago: totalAtual,
                tipo: 'LIQUIDACAO',
                origem: 'FECHAMENTO_CAMPEONATO',
                data: new Date(),
                metadata: { campeonato, temporada, posicaoFinal, precoLiquidacaoBase, splitFactorCumulativo, idemKey },
              },
            ],
            { session }
          );

          const [liq] = await Liquidacao.create(
            [
              {
                usuarioId: userDoc._id,
                usuarioLegacyId: userDoc.legacyId ?? null,
                clubeId: clubDoc._id,
                clubeLegacyId,
                clubeNome: clube.nome,
                campeonato,
                temporada,
                posicaoFinal,
                quantidade: qtdAtual,
                precoLiquidacaoBase,
                splitFactorCumulativo,
                precoLiquidacao,
                totalRecebido: totalAtual,
                saldoAntes,
                saldoDepois: userDoc.saldo,
                quantidadeAntesLiquidacao: qtdAtual,
                quantidadeDepoisLiquidacao: 0,
                ledgerEntryId: journal?.entry?.id || journal?.entryId || null,
                idemKey,
                status: 'processada',
                meta: {},
                dataLiquidacao: new Date(),
              },
            ],
            { session }
          );

          liquidacaoCriada = liq;
        },
      });

      if (liquidacaoCriada && String(liquidacaoCriada.status || '') === 'processada') {
        const valor = round2(liquidacaoCriada.totalRecebido ?? totalRecebido);
        totalGeral = round2(totalGeral + valor);
        totalUsuario = round2(totalUsuario + valor);
        liquidacoesUsuario.push({
          clubeId: clubeLegacyId,
          clubeNome: clube.nome,
          quantidade: Number(liquidacaoCriada.quantidade || qtd),
          posicaoFinal,
          valorUnitario: precoLiquidacao,
          totalRecebido: valor,
        });
        rankingPorClubeId[clubeLegacyId] = posicaoFinal;
      }
    }

    if (liquidacoesUsuario.length) {
      resumoUsuarios.push({
        usuarioId: String(usuario._id),
        usuarioLegacyId: usuario.legacyId ?? null,
        totalRecebido: totalUsuario,
        liquidacoes: liquidacoesUsuario,
      });
    }
  }

  return { ok: true, campeonato, temporada, totalGeral: round2(totalGeral), resumoUsuarios, rankingPorClubeId };
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
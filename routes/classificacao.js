require('dotenv').config();

if (!process.env.API_FOOTBALL_KEY) {

  throw new Error('CHAVE API_FOOTBALL_KEY está indefinida! Verifique o .env e a execução do servidor.');

}

const express = require('express');

const router = express.Router();

const axios = require('axios');

const Club = require('../models/Club');

const User = require('../models/User');

const Investment = require('../models/Investment');

const Dividendo = require('../models/dividendos');

const Top4Rodada = require('../models/Top4Rodada');

const HistoricoPosse = require('../models/HistoricoPosse');

const { runTx, round2 } = require('../utils/tx');

const audit = require('../utils/audit');

const ledger = require('../utils/ledger');

function normalizarNome(str) {

  return String(str || '')

    .normalize('NFD')

    .replace(/[\u0300-\u036f]/g, '')

    .toLowerCase()

    .trim();

}

function calcularPrecoPorPosicao(posicao) {

  const precoBase = 5;

  return precoBase * Math.pow(1.05, 20 - Number(posicao));

}

async function atualizarClubsComStandings(standingsApi) {

  const clubes = await Club.find({});

  const mapaNomeParaClube = {};

  for (const c of clubes) {

    mapaNomeParaClube[normalizarNome(c.nome)] = c;

  }

  for (const item of standingsApi) {

    if (!item?.team?.name) continue;

    const nomeNorm = normalizarNome(item.team.name);

    const clube = mapaNomeParaClube[nomeNorm];

    if (!clube) continue;

    clube.posicao = Number(item.rank);

    clube.escudo = item.team.logo || clube.escudo || '';

    await clube.save();

  }

}

async function salvarSnapshotTop4(rodada, standingsApi) {

  const clubes = await Club.find({}).lean();

  const mapaNomeParaId = {};

  for (const c of clubes) {

    mapaNomeParaId[normalizarNome(c.nome)] = {

      mongoId: c._id,

      legacyId: c.legacyId,

    };

  }

  const top4 = standingsApi

    .filter((i) => i?.rank && i?.team?.name && Number(i.rank) >= 1 && Number(i.rank) <= 4)

    .map((i) => {

      const clubeRef = mapaNomeParaId[normalizarNome(i.team.name)];

      if (!clubeRef) return null;

      return {

        clubeId: clubeRef.mongoId,

        clubeLegacyId: clubeRef.legacyId,

        posicao: Number(i.rank),

      };

    })

    .filter(Boolean)

    .sort((a, b) => a.posicao - b.posicao);

  await Top4Rodada.findOneAndUpdate(

    { rodada: Number(rodada) },

    {

      $set: {

        rodada: Number(rodada),

        clubes: top4,

        data: new Date(),

      },

    },

    { upsert: true, new: true }

  );

}

async function salvarSnapshotPosse(rodada) {

  const usuarios = await User.find({}).lean();

  const ops = [];

  for (const u of usuarios) {

    const carteira = Array.isArray(u.carteira) ? u.carteira : [];

    for (const ativo of carteira) {

      const qtd = Number(ativo?.quantidade || 0);

      const clubeLegacyId = ativo?.clubeId;

      if (!u?._id || clubeLegacyId == null) continue;

      if (qtd <= 0) continue;

      const clube = await Club.findOne({ legacyId: Number(clubeLegacyId) }).lean();

      if (!clube) continue;

      ops.push({

        updateOne: {

          filter: {

            usuarioId: u._id,

            clubeId: clube._id,

            rodada: Number(rodada),

          },

          update: {

            $set: {

              usuarioId: u._id,

              usuarioLegacyId: u.legacyId ?? null,

              clubeId: clube._id,

              clubeLegacyId: Number(clubeLegacyId),

              rodada: Number(rodada),

              quantidade: qtd,

              data: new Date(),

            },

          },

          upsert: true,

        },

      });

    }

  }

  if (ops.length) {

    await HistoricoPosse.bulkWrite(ops);

  }

}

async function obterTop4DaRodada(rodada) {

  const snap = await Top4Rodada.findOne({ rodada: Number(rodada) }).lean();

  return snap?.clubes || [];

}

async function obterPosse(usuarioId, clubeId, rodada) {

  const registro = await HistoricoPosse.findOne({

    usuarioId,

    clubeId,

    rodada: Number(rodada),

  }).lean();

  return Number(registro?.quantidade || 0);

}

async function distribuirDividendosSeElegivel(rodadaAtual) {

  const ciclos = 4;

  const taxas = {

    1: 0.025,

    2: 0.018,

    3: 0.013,

    4: 0.009,

  };

  if (Number(rodadaAtual) < ciclos) return;

  const r0 = Number(rodadaAtual);

  const rodadas = [r0 - 3, r0 - 2, r0 - 1, r0];

  for (const r of rodadas) {

    const t = await obterTop4DaRodada(r);

    if (!t || t.length < 4) return;

  }

  const topAtual = await obterTop4DaRodada(r0);

  for (const item of topAtual) {

    const pos = Number(item.posicao);

    if (pos < 1 || pos > 4) continue;

    const clubeLegacyId = Number(item.clubeLegacyId);

    let estavel = true;

    for (const r of rodadas) {

      const top = await obterTop4DaRodada(r);

      const mesmo = top.find((x) => Number(x.posicao) === pos);

      if (!mesmo || Number(mesmo.clubeLegacyId) !== clubeLegacyId) {

        estavel = false;

        break;

      }

    }

    if (!estavel) continue;

    const taxa = Number(taxas[pos] ?? 0);

    if (!taxa || taxa <= 0) continue;

    const clube = await Club.findOne({ legacyId: clubeLegacyId });

    if (!clube) continue;

    const base = calcularPrecoPorPosicao(pos);

    const valorUnitario = round2(base * taxa);

    const possesPeriodo = await HistoricoPosse.find({

      clubeId: clube._id,

      rodada: { $in: rodadas },

      quantidade: { $gt: 0 },

    }).lean();

    const mapaPorUsuario = new Map();

    for (const p of possesPeriodo) {

      const key = String(p.usuarioId);

      if (!mapaPorUsuario.has(key)) mapaPorUsuario.set(key, []);

      mapaPorUsuario.get(key).push(p);

    }

    for (const [usuarioId, registros] of mapaPorUsuario.entries()) {

      if (registros.length < ciclos) continue;

      const quantidades = rodadas.map((r) => {

        const reg = registros.find((x) => Number(x.rodada) === Number(r));

        return Number(reg?.quantidade || 0);

      });

      const qtdElegivel = Math.min(...quantidades);

      if (!Number.isFinite(qtdElegivel) || qtdElegivel <= 0) continue;

      const idemKey = `div:${r0}:${usuarioId}:${clubeLegacyId}:${pos}`;

      const jaPago = await Dividendo.findOne({ idemKey });

      if (jaPago) continue;

      const totalPago = round2(qtdElegivel * valorUnitario);

      await runTx({

        action: 'DIVIDENDOS_RODADA',

        meta: {

          rodada: r0,

          usuarioId,

          clubeId: clubeLegacyId,

          posicao: pos,

        },

        mutate: async (session) => {

          const userDoc = await User.findById(usuarioId).session(session);

          if (!userDoc) return;

          userDoc.saldo = round2(Number(userDoc.saldo || 0) + totalPago);

          await userDoc.save({ session });

          const journal = await ledger.postJournal({

            action: 'DIVIDEND',

            idemKey,

            meta: {

              origem: 'RODADA',

              rodada: r0,

              posicao: pos,

              clubeId: clubeLegacyId,

              clubeNome: clube.nome,

              quantidade: qtdElegivel,

              valorUnitario,

              totalPago,

            },

            lines: [

              { account: `user:${String(userDoc._id)}`, debit: totalPago },

              { account: 'platform:equity', credit: totalPago },

            ],

            session,

          });

          await Dividendo.create(

            [

              {

                usuarioId: userDoc._id,

                clubeId: clube._id,

                usuarioLegacyId: userDoc.legacyId ?? null,

                clubeLegacyId,

                clubeNome: clube.nome,

                rodada: r0,

                posicao: pos,

                origem: 'RODADA',

                quantidade: qtdElegivel,

                valorUnitario,

                totalPago,

                idemKey,

                data: new Date(),

                meta: {

                  ledgerEntryId: journal?.entry?.id || null,

                  rodadasConsideradas: rodadas,

                  quantidadesPeriodo: quantidades,

                },

              },

            ],

            { session }

          );

          await Investment.create(

            [

              {

                legacyId: `div_${userDoc.legacyId || userDoc._id}_${clubeLegacyId}_${r0}_${pos}`,

                usuarioId: userDoc._id,

                usuarioLegacyId: userDoc.legacyId ?? null,

                clubeId: clube._id,

                clubeLegacyId,

                clubeNome: clube.nome,

                quantidade: qtdElegivel,

                precoUnitario: valorUnitario,

                valorUnitario,

                totalPago,

                tipo: 'DIVIDENDO',

                origem: 'RODADA',

                data: new Date(),

                metadata: {

                  rodada: r0,

                  posicao: pos,

                  quantidadesPeriodo: quantidades,

                },

              },

            ],

            { session }

          );

        },

      });

    }

  }

}

router.get('/tabela-brasileirao', async (req, res) => {

  try {

    const response = await axios({

      method: 'get',

      url: 'https://v3.football.api-sports.io/standings',

      headers: {

        'x-apisports-key': process.env.API_FOOTBALL_KEY,

        Accept: 'application/json',

      },

      params: {

        league: 71,

        season: 2026,

      },

    });

    const standings = response?.data?.response?.[0]?.league?.standings?.[0];

    if (!Array.isArray(standings)) {

      return res.status(502).json({

        erro: 'Resposta inválida da API-Football.',

        detalhes: response?.data || null,

      });

    }

    const rodadaApi = Math.max(

      ...standings.map((t) => Number(t?.all?.played || 0)).filter((n) => Number.isFinite(n))

    );

    await atualizarClubsComStandings(standings);

    if (rodadaApi > 0) {

      await salvarSnapshotTop4(rodadaApi, standings);

      await salvarSnapshotPosse(rodadaApi);

      await distribuirDividendosSeElegivel(rodadaApi);

    }

    const clubesMongo = await Club.find({}).lean();

    const mapaNome = {};

    for (const c of clubesMongo) {

      mapaNome[normalizarNome(c.nome)] = c;

    }

    const data = standings

      .map((item) => {

        const clubeLocal = mapaNome[normalizarNome(item?.team?.name)];

        if (!clubeLocal) return null;

        return {

          id: clubeLocal.legacyId,

          nome: clubeLocal.nome,

          escudo: item?.team?.logo || clubeLocal.escudo || '',

          posicao: Number(item?.rank || clubeLocal.posicao || 0),

          pontos: Number(item?.points || 0),

          jogos: Number(item?.all?.played || 0),

          vitorias: Number(item?.all?.win || 0),

          empates: Number(item?.all?.draw || 0),

          derrotas: Number(item?.all?.lose || 0),

          saldoGols: Number(item?.goalsDiff || 0),

          preco: Number(clubeLocal.preco || 0),

          precoAtual:

            clubeLocal.precoAtual != null

              ? Number(clubeLocal.precoAtual)

              : Number(clubeLocal.preco || 0),

          cotasDisponiveis: Number(clubeLocal.cotasDisponiveis || 0),

          cotasEmitidas: Number(clubeLocal.cotasEmitidas || 0),

          ipoEncerrado: Boolean(clubeLocal.ipoEncerrado),

        };

      })

      .filter(Boolean);

    return res.json({ data, rodada: rodadaApi });

  } catch (e) {

    console.error('[CLASSIFICACAO] erro:', e);

    await audit.logEvent({

      kind: 'CLASSIFICACAO',

      action: 'TABELA_BRASILEIRAO_FAIL',

      error: String(e),

    });

    return res.status(500).json({ erro: 'Erro ao carregar tabela.' });

  }

});

module.exports = router;
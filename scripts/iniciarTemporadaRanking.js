require('dotenv').config();
require('../LoadEnv');

const mongoose = require('mongoose');

const { connectDB } = require('../config/db');
const User = require('../models/User');
const Club = require('../models/Club');

const TEMPORADA = process.argv[2] || '2026-1';
const SALDO_INICIAL = 1000;

function calcularValorPosicoes(usuario, precosPorClube) {
  const carteira = Array.isArray(usuario.carteira)
    ? usuario.carteira
    : [];

  let valorPosicoes = 0;

  for (const ativo of carteira) {
    const clubeId = Number(
      ativo.clubeId ??
        ativo.clubeLegacyId ??
        ativo.idClube ??
        ativo.clube?.id ??
        ativo.clube?.legacyId
    );

    const quantidade = Number(
      ativo.quantidade ??
        ativo.cotas ??
        0
    );

    if (
      !Number.isFinite(clubeId) ||
      clubeId <= 0 ||
      !Number.isFinite(quantidade) ||
      quantidade <= 0
    ) {
      continue;
    }

    const precoClube = precosPorClube.get(
      String(clubeId)
    );

    const precoAtual = Number.isFinite(precoClube)
      ? precoClube
      : Number(
          ativo.precoMedio ??
            ativo.valorUnitario ??
            0
        );

    valorPosicoes += quantidade * precoAtual;
  }

  return Number(valorPosicoes.toFixed(2));
}

async function iniciarTemporada() {
  try {
    await connectDB();

    console.log(
      `[RANKING] Iniciando temporada ${TEMPORADA}`
    );

    console.log(
      `[RANKING] Saldo inicial: T$ ${SALDO_INICIAL.toFixed(2)}`
    );

    const [usuarios, clubes] = await Promise.all([
      User.find({}),
      Club.find({})
        .select('legacyId precoAtual preco')
        .lean(),
    ]);

    const precosPorClube = new Map(
      clubes.map((clube) => [
        String(clube.legacyId),
        Number(
          clube.precoAtual ??
            clube.preco ??
            0
        ),
      ])
    );

    const agora = new Date();

    let atualizados = 0;
    let ignorados = 0;

    for (const usuario of usuarios) {
      if (
        usuario.temporadaRanking === TEMPORADA &&
        usuario.patrimonioInicialTemporada != null
      ) {
        console.log(
          `[IGNORADO] ${usuario.nomeUsuario}: já está na temporada ${TEMPORADA}`
        );

        ignorados += 1;
        continue;
      }

      const valorPosicoes =
        calcularValorPosicoes(
          usuario,
          precosPorClube
        );

      const patrimonioInicial = Number(
        (
          SALDO_INICIAL +
          valorPosicoes
        ).toFixed(2)
      );

      usuario.saldo = SALDO_INICIAL;
      usuario.capitalInicial = SALDO_INICIAL;

      usuario.temporadaRanking =
        TEMPORADA;

      usuario.saldoInicialTemporada =
        SALDO_INICIAL;

      usuario.patrimonioInicialTemporada =
        patrimonioInicial;

      usuario.inicioTemporadaRanking =
        agora;

      usuario.rankingAtivo = true;

      await usuario.save();

      atualizados += 1;

      console.log(
        `[ATUALIZADO] ${usuario.nomeUsuario}: ` +
          `saldo T$ ${SALDO_INICIAL.toFixed(2)} | ` +
          `posições T$ ${valorPosicoes.toFixed(2)} | ` +
          `patrimônio-base T$ ${patrimonioInicial.toFixed(2)}`
      );
    }

    console.log('');
    console.log('[RANKING] Temporada iniciada.');
    console.log(
      `[RANKING] Usuários atualizados: ${atualizados}`
    );
    console.log(
      `[RANKING] Usuários ignorados: ${ignorados}`
    );
  } catch (err) {
    console.error(
      '[RANKING] Erro ao iniciar temporada:',
      err
    );

    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

iniciarTemporada();
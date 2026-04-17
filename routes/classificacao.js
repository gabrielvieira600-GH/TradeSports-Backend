require('dotenv').config();
console.log('[ENV DEBUG] API_FOOTBALL_KEY:', process.env.API_FOOTBALL_KEY);
if (!process.env.API_FOOTBALL_KEY) {
  throw new Error('CHAVE API_FOOTBALL_KEY está indefinida! Verifique o .env e a execução do servidor.');
}

const express = require('express');
const router = express.Router();
const axios = require('axios');
const ledger = require('../utils/ledger');
const fs = require('fs');
const path = require('path');

// Caminhos para arquivos locais
const clubesPath = path.join(__dirname, '..', 'data', 'clubes.json');
const classificacaoFinalPath = path.join(__dirname, '..', 'data', 'classificacaoFinal.json');

// ===================== DIVIDENDOS (TOP 4 estável por 4 rodadas) =====================
// Obs: o projeto está usando JSON (não Mongo) no momento.
const configCampeonatoPath = path.join(__dirname, '..', 'data', 'configCampeonato.json');
const top4RodadaPath = path.join(__dirname, '..', 'data', 'top4Rodadas.json');
const historicoPossePath = path.join(__dirname, '..', 'data', 'historicoPosse.json');
const usuariosPath = path.join(__dirname, '..', 'data', 'usuarios.json');
const investimentosPath = path.join(__dirname, '..', 'data', 'investimentos.json');

function lerJSONSeguroAbs(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function salvarJSONAbs(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function garantirArquivo(p, valorInicial) {
  try {
    if (!fs.existsSync(p)) salvarJSONAbs(p, valorInicial);
  } catch (e) {
    console.error('[DIVIDENDOS] Erro ao garantir arquivo', p, e.message);
  }
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function calcularPrecoPorPosicao(posicao) {
  const precoBase = 5;
  return precoBase * Math.pow(1.05, 20 - Number(posicao));
}

function obterNomeClube(clubeId) {
  const clubes = lerJSONSeguroAbs(clubesPath, []);
  const c = clubes.find((x) => String(x.id) === String(clubeId));
  return c?.nome || '';
}

function salvarSnapshotTop4(rodada, standingsApi) {
  const clubes = lerJSONSeguroAbs(clubesPath, []);
  const mapaNomeParaId = {};
  for (const c of clubes) {
    if (!c || c.id == null) continue;
    mapaNomeParaId[normalizarNome(c.nome)] = c.id;
  }

  const top4 = standingsApi
    .filter((i) => i?.rank && i?.team?.name && Number(i.rank) >= 1 && Number(i.rank) <= 4)
    .map((i) => {
      const clubeId = mapaNomeParaId[normalizarNome(i.team.name)];
      return clubeId == null
        ? null
        : { clubeId: Number(clubeId), posicao: Number(i.rank) };
    })
    .filter(Boolean)
    .sort((a, b) => a.posicao - b.posicao);

  garantirArquivo(top4RodadaPath, []);
  const hist = lerJSONSeguroAbs(top4RodadaPath, []);
  const idx = hist.findIndex((r) => Number(r.rodada) === Number(rodada));
  const registro = { rodada: Number(rodada), clubes: top4, data: new Date().toISOString() };
  if (idx >= 0) hist[idx] = registro;
  else hist.push(registro);
  hist.sort((a, b) => Number(a.rodada) - Number(b.rodada));
  salvarJSONAbs(top4RodadaPath, hist);
}

function salvarSnapshotPosse(rodada) {
  garantirArquivo(historicoPossePath, []);
  const hist = lerJSONSeguroAbs(historicoPossePath, []);

  // remove snapshots já existentes dessa rodada (para idempotência)
  const filtrado = hist.filter((x) => Number(x.rodada) !== Number(rodada));

  const usuarios = lerJSONSeguroAbs(usuariosPath, []);
  const novos = [];

  for (const u of usuarios) {
    const uid = u?.id;
    const carteira = Array.isArray(u?.carteira) ? u.carteira : [];
    for (const ativo of carteira) {
      const qtd = Number(ativo?.quantidade || 0);
      const clubeId = ativo?.clubeId;
      if (!uid || clubeId == null) continue;
      if (qtd <= 0) continue;

      novos.push({
        usuarioId: uid,
        clubeId: Number(clubeId),
        rodada: Number(rodada),
        quantidade: qtd,
        data: new Date().toISOString(),
      });
    }
  }

  salvarJSONAbs(historicoPossePath, [...filtrado, ...novos]);
}

function obterTop4DaRodada(rodada) {
  const hist = lerJSONSeguroAbs(top4RodadaPath, []);
  const r = hist.find((x) => Number(x.rodada) === Number(rodada));
  if (!r || !Array.isArray(r.clubes)) return [];
  return r.clubes;
}

function obterPosse(usuarioId, clubeId, rodada) {
  const hist = lerJSONSeguroAbs(historicoPossePath, []);
  const r = hist.find(
    (x) =>
      String(x.usuarioId) === String(usuarioId) &&
      String(x.clubeId) === String(clubeId) &&
      Number(x.rodada) === Number(rodada)
  );
  return Number(r?.quantidade || 0);
}

function jaPagouDividendo(investimentos, usuarioId, clubeId, rodada, posicao) {
  return investimentos.some(
    (i) =>
      String(i.usuarioId) === String(usuarioId) &&
      String(i.clubeId) === String(clubeId) &&
      Number(i.rodada) === Number(rodada) &&
      Number(i.posicao) === Number(posicao) &&
      String(i.tipo).toUpperCase() === 'DIVIDENDO'
  );
}

async function distribuirDividendosSeElegivel(rodadaAtual) {
  garantirArquivo(top4RodadaPath, []);
  garantirArquivo(historicoPossePath, []);
  garantirArquivo(investimentosPath, []);

  const config = lerJSONSeguroAbs(configCampeonatoPath, {});
  const ciclos = Number(config?.dividendos?.ciclosMinimos || 4);
  const taxas = config?.dividendos?.taxasPorPosicao || {
    1: 0.025,
    2: 0.018,
    3: 0.013,
    4: 0.009,
  };

  if (Number(rodadaAtual) < ciclos) return;

  const r0 = Number(rodadaAtual);
  const rodadas = [r0 - (ciclos - 1), r0 - (ciclos - 2), r0 - 1, r0];

  // precisa ter snapshot top4 das 4 rodadas
  for (const r of rodadas) {
    const t = obterTop4DaRodada(r);
    if (!t || t.length < 4) return;
  }

  const topAtual = obterTop4DaRodada(r0);
  const usuarios = lerJSONSeguroAbs(usuariosPath, []);
  const investimentos = lerJSONSeguroAbs(investimentosPath, []);

  const novosInvestimentos = [];

  for (const item of topAtual) {
    const pos = Number(item.posicao);
    if (pos < 1 || pos > 4) continue;

    // verifica estabilidade do mesmo clube na mesma posição nas 4 rodadas
    const clubeId = Number(item.clubeId);
    let estavel = true;
    for (const r of rodadas) {
      const top = obterTop4DaRodada(r);
      const mesmo = top.find((x) => Number(x.posicao) === pos);
      if (!mesmo || Number(mesmo.clubeId) !== clubeId) {
        estavel = false;
        break;
      }
    }
    if (!estavel) continue;

    const taxa = Number(taxas[pos] ?? 0);
    if (!Number.isFinite(taxa) || taxa <= 0) continue;

    const base = calcularPrecoPorPosicao(pos);
    const valorUnitario = round2(base * taxa);
    const clubeNome = obterNomeClube(clubeId);

    for (let ui = 0; ui < usuarios.length; ui++) {
      const u = usuarios[ui];
      const uid = u?.id;
      if (!uid) continue;

      // min de posse nas 4 rodadas
      const posses = rodadas.map((r) => obterPosse(uid, clubeId, r));
      const qtdElegivel = Math.min(...posses);
      if (!Number.isFinite(qtdElegivel) || qtdElegivel <= 0) continue;

      if (jaPagouDividendo(investimentos, uid, clubeId, r0, pos)) continue;

      const totalPago = round2(qtdElegivel * valorUnitario);
      if (totalPago <= 0) continue;

      // Ledger (CAMADA 13): registra e aplica crédito do dividendo no saldo do usuário (via applyToUsuarios)
      const temporada = Number(config?.temporada || 0);
      const idemKey = `div:${temporada}:${r0}:${uid}:${clubeId}:${pos}`;
      await ledger.postJournal({
        action: 'DIVIDEND',
        idemKey,
        meta: {
          origem: 'RODADA',
          temporada,
          rodada: r0,
          posicao: pos,
          clubeId,
          clubeNome,
          quantidade: qtdElegivel,
          valorUnitario,
          totalPago,
        },
        lines: [
          { account: `user:${uid}`, debit: totalPago },
          { account: 'platform:equity', credit: totalPago },
        ],
        applyToUsuarios: { usuariosPath },
      });

      novosInvestimentos.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        usuarioId: uid,
        tipo: 'DIVIDENDO',
        origem: 'RODADA',
        rodada: r0,
        posicao: pos,
        clubeId,
        clubeNome,
        quantidade: qtdElegivel,
        valorUnitario,
        totalPago,
        data: new Date().toISOString(),
      });
    }
  }
  if (novosInvestimentos.length > 0) {
    salvarJSONAbs(investimentosPath, [...investimentos, ...novosInvestimentos]);
    console.log(`🟣 [DIVIDENDOS] Pagamentos gerados na rodada ${r0}:`, novosInvestimentos.length);
  }
}

// Helpers de JSON
function lerJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[CLASSIFICACAO] Erro ao ler', p, e.message);
    return fallback;
  }
}

function salvarJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

// Normaliza nomes para comparação (remove acentos, caixa baixa, trim)
function normalizarNome(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Atualiza backend/data/classificacaoFinal.json
 * a partir do array de standings da API-Football.
 *
 * standingsApi = response.data.response[0].league.standings[0]
 * (cada item tem team, rank, etc.)
 */
function atualizarClassificacaoFinal(standingsApi) {
  const clubes = lerJSON(clubesPath, []);

  // Mapa nomeNormalizado -> idInterno
  const mapaNomeParaId = {};
  for (const c of clubes) {
    if (!c || c.id == null) continue;
    const nomeNorm = normalizarNome(c.nome);
    mapaNomeParaId[nomeNorm] = c.id;
  }

  const classificacaoFinal = [];

  for (const item of standingsApi) {
    if (!item || !item.team) continue;

    const nomeTimeApi = item.team.name;
    const posicao     = item.rank;

    if (posicao == null || !nomeTimeApi) continue;

    const nomeNorm = normalizarNome(nomeTimeApi);
    const clubeId  = mapaNomeParaId[nomeNorm];

    if (clubeId == null) {
      console.warn('[CLASSIFICACAO] Não encontrei clube em clubes.json para nome da API:', nomeTimeApi);
      continue;
    }

    classificacaoFinal.push({
      clubeId,
      posicao: Number(posicao),
    });
  }

  salvarJSON(classificacaoFinalPath, classificacaoFinal);
  console.log('🟢 [CLASSIFICACAO] classificacaoFinal.json atualizado com', classificacaoFinal.length, 'clubes.');
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
        season: 2025
      }
    });

    const standings = response?.data?.response?.[0]?.league?.standings?.[0];

if (!Array.isArray(standings)) {
  console.error('[API-Football] Resposta inesperada:', response?.data);
  return res.status(502).json({
    erro: 'Resposta inválida da API-Football.',
    detalhes: response?.data || null,
  });
}

    // ===================== RODADA ATUAL (via jogos disputados) =====================
    // A API de standings não traz "rodada" diretamente. Uma forma consistente aqui é
    // usar o maior número de jogos disputados entre os clubes (matchday aproximado).
    const rodadaApi = Math.max(
      ...standings
        .map((t) => Number(t?.all?.played || 0))
        .filter((n) => Number.isFinite(n))
    );

    // garante config + defaults de dividendos
    garantirArquivo(configCampeonatoPath, {
      campeonato: 'Brasileirao',
      temporada: 2023,
      dispararLiquidacao: false,
      liquidado: false,
      rodadaAtual: rodadaApi,
      dividendos: {
        ciclosMinimos: 4,
        taxasPorPosicao: { 1: 0.025, 2: 0.018, 3: 0.013, 4: 0.009 },
      },
      ultimaRodadaProcessadaDividendos: 0,
    });

    // 🔹 NOVO: atualiza classificacaoFinal.json sem mudar a resposta pro front
    try {
      atualizarClassificacaoFinal(standings);
    } catch (e) {
      console.error('[CLASSIFICACAO] Erro ao atualizar classificacaoFinal.json:', e.message);
    }

    // ===================== SNAPSHOT + DIVIDENDOS QUANDO RODADA MUDAR =====================
    try {
      const config = lerJSONSeguroAbs(configCampeonatoPath, {});
      const rodadaAnterior = Number(config?.rodadaAtual || 0);

      // se a rodada mudou, salva snapshots da nova rodada e tenta pagar dividendos
      if (Number.isFinite(rodadaApi) && rodadaApi > 0 && rodadaApi !== rodadaAnterior) {
        // salva snapshots da rodada atual
        salvarSnapshotTop4(rodadaApi, standings);
        salvarSnapshotPosse(rodadaApi);

        // atualiza config
        config.rodadaAtual = rodadaApi;

        // tenta distribuir dividendos apenas 1x por rodada
        const ultimaProc = Number(config?.ultimaRodadaProcessadaDividendos || 0);
        if (rodadaApi > ultimaProc) {
          await distribuirDividendosSeElegivel(rodadaApi);
          config.ultimaRodadaProcessadaDividendos = rodadaApi;
        }

        salvarJSONAbs(configCampeonatoPath, config);
      } else {
        // primeira execução (sem rodadaAnterior) ou mesma rodada: garante pelo menos snapshots iniciais
        if (!rodadaAnterior && rodadaApi > 0) {
          salvarSnapshotTop4(rodadaApi, standings);
          salvarSnapshotPosse(rodadaApi);
          config.rodadaAtual = rodadaApi;
          salvarJSONAbs(configCampeonatoPath, config);
        }
      }
    } catch (e) {
      console.error('[DIVIDENDOS] Erro no snapshot/distribuição:', e.message);
    }

    res.json({
      success: true,
      data: standings.map(team => ({
        posicao: team.rank,
        nome: team.team.name,
        pontos: team.points,
        jogos: team.all.played,
        vitorias: team.all.win,
        empates: team.all.draw,
        derrotas: team.all.lose
      }))
    });

  } catch (error) {
  const detalhes = error.response?.data || error.message || null;
  console.error('[API-Football] Erro ao buscar tabela:', detalhes);

  return res.status(500).json({
    erro: 'Erro ao buscar tabela da API-Football.',
    detalhes,
  });
}
});

router.get('/tabela-laliga', async (req, res) => {

  try {
    const response = await axios({
      method: 'get',
      url: 'https://v3.football.api-sports.io/standings' ,
      headers: {
        'x-apisports-key' : 'a3118e9a451a60bae40400fa6b255037',
        'Accept' : 'application/json'
      },
      params: {
        league: 140,
        season: 2023
      }
    });

    const standings = response.data.response[0].league.standings[0];

    res.json({
      success: true,
      data: standings.map(team => ({
        posicao: team.rank,
        nome: team.team.name,
        pontos: team.points,
        jogos: team.all.played,
        vitorias: team.all.win,
        empates: team.all.draw,
        derrotas: team.all.lose
      }))
    });

  } catch (error) {
    console.error('[API-Football] Erro ao buscar tabela:', error.response?.data || error.message);
    res.status(500).json({ erro: 'Erro ao buscar tabela da API-Football.' });
  }
});

router.get('/tabela-premierleague', async (req, res) => {

  try {
    const response = await axios({
      method: 'get',
      url: 'https://v3.football.api-sports.io/standings' ,
      headers: {
        'x-apisports-key' : 'a3118e9a451a60bae40400fa6b255037',
        'Accept' : 'application/json'
      },
      params: {
        league: 39,
        season: 2023
      }
    });

    const standings = response.data.response[0].league.standings[0];

    res.json({
      success: true,
      data: standings.map(team => ({
        posicao: team.rank,
        nome: team.team.name,
        pontos: team.points,
        jogos: team.all.played,
        vitorias: team.all.win,
        empates: team.all.draw,
        derrotas: team.all.lose
      }))
    });

  } catch (error) {
    console.error('[API-Football] Erro ao buscar tabela:', error.response?.data || error.message);
    res.status(500).json({ erro: 'Erro ao buscar tabela da API-Football.' });
  }
});

module.exports = router;

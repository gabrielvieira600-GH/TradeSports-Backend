// routes/api/admin.js (CAMADA 12 + SPLIT)
// Admin endpoints: status + dividendos + liquidação + split manual
// Projeto em JSON (sem Mongo). Mantém auth + isAdmin.

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const auth = require('../../middleware/auth');
const isAdmin = require('../../middleware/admin');
const audit = require('../../utils/audit');

const { liquidarBrasileirao } = require('../../middleware/checkLiquidacao');
const { registrarSplit } = require('../../utils/ledger');

const dataDir = path.join(__dirname, '..', '..', 'data');
const configPath = path.join(dataDir, 'configCampeonato.json');
const usuariosPath = path.join(dataDir, 'usuarios.json');
const clubesPath = path.join(dataDir, 'clubes.json');
const investimentosPath = path.join(dataDir, 'investimentos.json');
const ordensPath = path.join(dataDir, 'ordens.json');
const top4RodadasPath = path.join(dataDir, 'top4Rodadas.json');
const historicoPossePath = path.join(dataDir, 'historicoPosse.json');

function readJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function getClubNameMap() {
  const clubes = readJSON(clubesPath, []);
  const m = new Map();
  for (const c of clubes) {
    if (!c || c.id == null) continue;
    m.set(String(c.id), c.nome || '');
  }
  return m;
}

// ====== Auth obrigatório em tudo
router.use(auth);
router.use(isAdmin);

// =====================================================
// GET /api/admin/status
// =====================================================
router.get('/status', (req, res) => {
  const cfg = readJSON(configPath, {});
  const usuarios = readJSON(usuariosPath, []);
  const clubes = readJSON(clubesPath, []);
  const inv = readJSON(investimentosPath, []);
  const top4 = readJSON(top4RodadasPath, []);
  const posse = readJSON(historicoPossePath, []);
  const ordens = readJSON(ordensPath, []);

  const auditPath = path.join(dataDir, 'audit_logs.json');
  const auditLogs = readJSON(auditPath, []);
  const lastAudit = Array.isArray(auditLogs) ? auditLogs.slice(-20).reverse() : [];

  return res.json({
    ok: true,
    config: cfg,
    counts: {
      usuarios: usuarios.length,
      clubes: clubes.length,
      investimentos: inv.length,
      ordens: ordens.length,
      top4Snapshots: top4.length,
      posseSnapshots: posse.length,
    },
    lastAudit,
    ts: new Date().toISOString(),
  });
});

// =====================================================
// POST /api/admin/dividendos/disparar
// body opcional: { rodada: 12 }
//
// Regras:
// - Top 4 deve estar estável na MESMA POSIÇÃO por N rodadas consecutivas
//   N = config.dividendos.ciclosMinimos (default 4)
// - Holding: paga pela MENOR quantidade em posse no período (min das rodadas)
// - Idempotente por (usuarioId, clubeId, rodada, posicao, tipo=DIVIDENDO)
// =====================================================
router.post('/dividendos/disparar', (req, res) => {
  try {
    const cfg = readJSON(configPath, {});
    const ciclosMinimos = Number(cfg?.dividendos?.ciclosMinimos || 4);
    const valoresPorPosicao = Array.isArray(cfg?.dividendos?.valoresPorPosicao)
      ? cfg.dividendos.valoresPorPosicao.map(Number)
      : [1.5, 1.2, 1.0, 0.8];

    const top4Hist = readJSON(top4RodadasPath, []);
    const posseHist = readJSON(historicoPossePath, []);
    const usuarios = readJSON(usuariosPath, []);
    const investimentos = readJSON(investimentosPath, []);
    const clubNameMap = getClubNameMap();

    const rodadaBody = req.body && Number(req.body.rodada);
    const rodadaAtual =
      Number.isFinite(rodadaBody) ? rodadaBody :
      Number.isFinite(Number(cfg?.rodadaAtual)) ? Number(cfg.rodadaAtual) :
      (Array.isArray(top4Hist) && top4Hist.length ? Number(top4Hist[top4Hist.length - 1].rodada) : 0);

    if (!rodadaAtual || rodadaAtual < 1) {
      return res.status(400).json({
        erro: 'Rodada inválida. Informe body { rodada } ou configure configCampeonato.rodadaAtual.'
      });
    }

    const startRodada = rodadaAtual - ciclosMinimos + 1;
    if (startRodada < 1) {
      return res.status(400).json({
        erro: `Ainda não há rodadas suficientes para dividendos. Precisa de ${ciclosMinimos} rodadas.`
      });
    }

    const janela = [];
    for (let r = startRodada; r <= rodadaAtual; r++) {
      const snap = top4Hist.find((x) => Number(x.rodada) === Number(r));
      if (!snap || !Array.isArray(snap.clubes)) {
        return res.status(400).json({
          erro: `Snapshot Top4 ausente na rodada ${r} (top4Rodadas.json).`
        });
      }
      janela.push({ rodada: r, clubes: snap.clubes });
    }

    const elegiveis = [];
    for (let pos = 1; pos <= 4; pos++) {
      let clubeIdEstavel = null;
      let ok = true;
      for (const j of janela) {
        const item = j.clubes.find((c) => Number(c.posicao) === Number(pos));
        if (!item || item.clubeId == null) { ok = false; break; }
        const cid = String(item.clubeId);
        if (clubeIdEstavel == null) clubeIdEstavel = cid;
        if (clubeIdEstavel !== cid) { ok = false; break; }
      }
      if (ok && clubeIdEstavel != null) elegiveis.push({ posicao: pos, clubeId: clubeIdEstavel });
    }

    if (!elegiveis.length) {
      return res.json({
        ok: true,
        rodada: rodadaAtual,
        ciclosMinimos,
        pagos: 0,
        detalhe: 'Nenhum clube Top4 manteve mesma posição no período.'
      });
    }

    let pagos = 0;
    const creditos = [];

    for (const { posicao, clubeId } of elegiveis) {
      const valorUnitario = Number(valoresPorPosicao[posicao - 1] ?? 0);
      if (!valorUnitario || valorUnitario <= 0) continue;

      for (const u of usuarios) {
        const uid = u?.id;
        if (uid == null) continue;

        const posses = [];
        for (let r = startRodada; r <= rodadaAtual; r++) {
          const p = posseHist.find(
            (x) =>
              String(x.usuarioId) === String(uid) &&
              String(x.clubeId) === String(clubeId) &&
              Number(x.rodada) === Number(r)
          );
          posses.push(Number(p?.quantidade || 0));
        }

        const menorQtd = Math.min(...posses);
        if (!Number.isFinite(menorQtd) || menorQtd <= 0) continue;

        const ja = investimentos.some((i) =>
          String(i.tipo || '').toUpperCase() === 'DIVIDENDO' &&
          String(i.usuarioId) === String(uid) &&
          String(i.clubeId) === String(clubeId) &&
          Number(i.rodada) === Number(rodadaAtual) &&
          Number(i.posicao) === Number(posicao)
        );
        if (ja) continue;

        const totalPago = round2(menorQtd * valorUnitario);

        const idxU = usuarios.findIndex((x) => String(x.id) === String(uid));
        if (idxU < 0) continue;

        usuarios[idxU].saldo = round2(Number(usuarios[idxU].saldo || 0) + totalPago);

        investimentos.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          tipo: 'DIVIDENDO',
          origem: 'ADMIN_MANUAL',
          usuarioId: uid,
          clubeId: Number(clubeId),
          clubeNome: clubNameMap.get(String(clubeId)) || '',
          quantidade: Number(menorQtd),
          valorUnitario: round2(valorUnitario),
          totalPago,
          rodada: Number(rodadaAtual),
          posicao: Number(posicao),
          data: new Date().toISOString(),
        });

        pagos++;
        creditos.push({
          usuarioId: uid,
          clubeId: Number(clubeId),
          posicao,
          quantidade: Number(menorQtd),
          valorUnitario: round2(valorUnitario),
          totalPago
        });
      }
    }

    writeJSON(usuariosPath, usuarios);
    writeJSON(investimentosPath, investimentos);

    audit.logEvent({
      kind: 'ADMIN',
      action: 'DIVIDENDOS_MANUAL_OK',
      userId: req.usuario?.id || null,
      meta: { rodada: rodadaAtual, ciclosMinimos, pagos, creditosCount: creditos.length, elegiveis },
    });

    return res.json({
      ok: true,
      rodada: rodadaAtual,
      ciclosMinimos,
      elegiveis,
      pagos,
      creditos: creditos.slice(0, 50)
    });
  } catch (err) {
    console.error('[ADMIN DIVIDENDOS] erro:', err);
    audit.logEvent({
      kind: 'ADMIN',
      action: 'DIVIDENDOS_MANUAL_FAIL',
      userId: req.usuario?.id || null,
      error: String(err),
    });
    return res.status(500).json({ erro: 'Erro interno ao disparar dividendos.' });
  }
});

// =====================================================
// POST /api/admin/liquidacao/disparar
// =====================================================
router.post('/liquidacao/disparar', async (req, res) => {
  try {
    await liquidarBrasileirao();

    audit.logEvent({
      kind: 'ADMIN',
      action: 'LIQUIDACAO_MANUAL_OK',
      userId: req.usuario?.id || null,
    });

    return res.json({
      ok: true,
      mensagem: 'Liquidação disparada com sucesso.'
    });
  } catch (err) {
    console.error('[ADMIN LIQUIDACAO] erro:', err);

    audit.logEvent({
      kind: 'ADMIN',
      action: 'LIQUIDACAO_MANUAL_FAIL',
      userId: req.usuario?.id || null,
      error: String(err),
    });

    return res.status(500).json({ erro: 'Erro interno ao disparar liquidação.' });
  }
});

// =====================================================
// POST /api/admin/split
// body: { clubeId: number, ratio: number }
// Split administrativo de cotas
// =====================================================
router.post('/split', (req, res) => {
  try {
    const clubeId = Number(req.body?.clubeId);
    const ratio = Number(req.body?.ratio);

    if (!clubeId || !ratio || ratio <= 1) {
      return res.status(400).json({
        erro: 'Parâmetros inválidos. Informe clubeId e ratio > 1.'
      });
    }

    const clubes = readJSON(clubesPath, []);
    const usuarios = readJSON(usuariosPath, []);
    const ordens = readJSON(ordensPath, []);
    const investimentos = readJSON(investimentosPath, []);

    const clube = clubes.find((c) => Number(c.id) === clubeId);

    if (!clube) {
      return res.status(404).json({ erro: 'Clube não encontrado.' });
    }

    const precoAntes = Number(clube.precoAtual || clube.preco || 0);
    const splitFactorAnterior = Number(clube.splitFactorCumulativo || 1);

    // =============================
    // 1. AJUSTE DO CLUBE
    // =============================
    clube.preco = Number((Number(clube.preco || 0) / ratio).toFixed(2));
    clube.precoAtual = Number((Number(clube.precoAtual || clube.preco || 0) / ratio).toFixed(2));

    if (clube.cotasEmitidas != null) {
      clube.cotasEmitidas = Number(clube.cotasEmitidas) * ratio;
    }

    if (clube.cotasDisponiveis != null) {
      clube.cotasDisponiveis = Number(clube.cotasDisponiveis) * ratio;
    }

    clube.splitFactorCumulativo = splitFactorAnterior * ratio;

    if (!Array.isArray(clube.splits)) {
      clube.splits = [];
    }

    clube.splits.push({
      ratio,
      data: new Date().toISOString(),
      executadoPor: req.usuario?.id || null,
      precoAntes,
      precoDepois: clube.precoAtual,
    });

    // =============================
    // 2. AJUSTE DA CARTEIRA DOS USUÁRIOS
    // =============================
    usuarios.forEach((usuario) => {
      if (!Array.isArray(usuario.carteira)) return;

      usuario.carteira.forEach((posicao) => {
        if (Number(posicao.clubeId) === clubeId) {
          const qtdAntes = Number(posicao.quantidade || 0);
          const pmAntes = Number(posicao.precoMedio || 0);

          posicao.quantidade = qtdAntes * ratio;
          posicao.precoMedio = Number((pmAntes / ratio).toFixed(4));

          if (posicao.totalInvestido != null) {
            posicao.totalInvestido = Number(
              (Number(posicao.totalInvestido || 0)).toFixed(2)
            );
          }
        }
      });
    });

    // =============================
    // 3. AJUSTE DAS ORDENS ABERTAS
    // =============================
    ordens.forEach((ordem) => {
      const mesmoClube = Number(ordem.clubeId) === clubeId;
      const aberta =
        ordem.status === 'aberta' ||
        ordem.status === 'pendente' ||
        ordem.status === 'parcial';

      if (mesmoClube && aberta) {
        ordem.quantidade = Number(ordem.quantidade || 0) * ratio;

        if (ordem.restante != null) {
          ordem.restante = Number(ordem.restante || 0) * ratio;
        }

        ordem.preco = Number((Number(ordem.preco || 0) / ratio).toFixed(2));
      }
    });

    // =============================
    // 4. AJUSTE DOS INVESTIMENTOS / HISTÓRICO
    // =============================
    investimentos.forEach((inv) => {
      if (Number(inv.clubeId) === clubeId) {
        inv.quantidade = Number(inv.quantidade || 0) * ratio;

        if (inv.precoUnitario != null) {
          inv.precoUnitario = Number(
            (Number(inv.precoUnitario || 0) / ratio).toFixed(4)
          );
        }

        if (inv.valorUnitario != null) {
          inv.valorUnitario = Number(
            (Number(inv.valorUnitario || 0) / ratio).toFixed(4)
          );
        }

        if (inv.totalPago != null) {
          inv.totalPago = Number(Number(inv.totalPago).toFixed(2));
        }

        if (inv.totalInvestido != null) {
          inv.totalInvestido = Number(Number(inv.totalInvestido).toFixed(2));
        }

        if (inv.totalRecebido != null) {
          inv.totalRecebido = Number(Number(inv.totalRecebido).toFixed(2));
        }
      }
    });

    // =============================
    // 5. SALVAR
    // =============================
    writeJSON(clubesPath, clubes);
    writeJSON(usuariosPath, usuarios);
    writeJSON(ordensPath, ordens);
    writeJSON(investimentosPath, investimentos);

    // =============================
    // 6. AUDITORIA / LEDGER
    // =============================
    try {
      registrarSplit({
        clubeId,
        ratio,
      });
    } catch (ledgerErr) {
      console.error('[ADMIN SPLIT] erro ao registrar split no ledger:', ledgerErr);
    }

    audit.logEvent({
      kind: 'ADMIN',
      action: 'SPLIT_EXEC_OK',
      userId: req.usuario?.id || null,
      meta: {
        clubeId,
        clubeNome: clube.nome || '',
        ratio,
        precoAntes,
        precoDepois: clube.precoAtual,
        splitFactorCumulativo: clube.splitFactorCumulativo,
      },
    });

    return res.json({
      ok: true,
      mensagem: `Split ${ratio}:1 executado com sucesso no clube ${clube.nome}.`,
      clube: {
        id: clube.id,
        nome: clube.nome,
        precoAntes,
        precoDepois: clube.precoAtual,
        splitFactorCumulativo: clube.splitFactorCumulativo,
      },
    });
  } catch (err) {
    console.error('[ADMIN SPLIT] erro:', err);

    audit.logEvent({
      kind: 'ADMIN',
      action: 'SPLIT_EXEC_FAIL',
      userId: req.usuario?.id || null,
      error: String(err),
    });

    return res.status(500).json({ erro: 'Erro interno ao executar split.' });
  }
});

module.exports = router;
const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const ledger = require('./ledger');
const antifraude = require('./antifraude');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJson(file, fallback) {
  return storage.readJSON(path.join(DATA_DIR, file), fallback);
}

function exists(file) {
  return fs.existsSync(path.join(DATA_DIR, file));
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function envBool(name, defaultValue = false) {
  const v = String(process.env[name] ?? defaultValue).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(v);
}

function runSystemCheck() {
  const problemasCriticos = [];
  const problemasMedios = [];
  const avisos = [];

  const usuarios = readJson('usuarios.json', []);
  const ordens = readJson('ordens.json', []);
  const clubes = readJson('clubes.json', []);
  const investimentos = readJson('investimentos.json', []);
  const journal = readJson(path.basename(ledger.paths.JOURNAL_PATH), []);
  const financeiro = ledger.readFinancialTx ? ledger.readFinancialTx() : [];
  const antifraudeState = antifraude.loadState ? antifraude.loadState() : { users: {}, ips: {}, clubes: {} };

  const requiredFiles = [
    'usuarios.json',
    'ordens.json',
    'clubes.json',
    'investimentos.json',
    'ledger_journal.json',
    'ledger_idem.json',
    'financeiro_transacoes.json',
    'idempotency.json'
  ];

  for (const f of requiredFiles) {
    if (!exists(f)) problemasCriticos.push({ tipo: 'ARQUIVO_AUSENTE', arquivo: f });
  }

  for (const u of safeArray(usuarios)) {
    if (Number(u?.saldo || 0) < 0) {
      problemasCriticos.push({ tipo: 'SALDO_NEGATIVO', usuarioId: u.id, saldo: Number(u.saldo || 0) });
    }

    const carteira = safeArray(u?.carteira);
    for (const ativo of carteira) {
      if (Number(ativo?.quantidade || 0) < 0) {
        problemasCriticos.push({
          tipo: 'CARTEIRA_NEGATIVA',
          usuarioId: u.id,
          clubeId: ativo?.clubeId,
          quantidade: Number(ativo?.quantidade || 0)
        });
      }
    }
  }

  for (const o of safeArray(ordens)) {
    if (!o?.id) problemasMedios.push({ tipo: 'ORDEM_SEM_ID' });
    if (!o?.clubeId) problemasMedios.push({ tipo: 'ORDEM_SEM_CLUBE', ordemId: o?.id || null });
    if (!o?.usuarioId) problemasMedios.push({ tipo: 'ORDEM_SEM_USUARIO', ordemId: o?.id || null });
    if (Number(o?.quantidade || 0) <= 0) problemasCriticos.push({ tipo: 'ORDEM_QTD_INVALIDA', ordemId: o?.id || null });
    if (Number(o?.preco || 0) <= 0) problemasCriticos.push({ tipo: 'ORDEM_PRECO_INVALIDO', ordemId: o?.id || null });
    if (Number(o?.restante || 0) < 0) problemasCriticos.push({ tipo: 'ORDEM_RESTANTE_NEGATIVO', ordemId: o?.id || null });

    if (String(o?.tipo) === 'venda') {
      const user = safeArray(usuarios).find((u) => String(u.id) === String(o.usuarioId));
      const pos = safeArray(user?.carteira).find((a) => String(a.clubeId) === String(o.clubeId));
      const qtdDisponivel = Number(pos?.quantidade || 0);
      if (Number(o?.restante || 0) > qtdDisponivel) {
        problemasCriticos.push({
          tipo: 'VENDA_EXCEDE_POSICAO',
          ordemId: o.id,
          usuarioId: o.usuarioId,
          clubeId: o.clubeId,
          restante: Number(o.restante || 0),
          disponivel: qtdDisponivel
        });
      }
    }

    if (String(o?.tipo) === 'compra') {
      const user = safeArray(usuarios).find((u) => String(u.id) === String(o.usuarioId));
      const total = Math.round(Number(o?.restante || 0) * Number(o?.preco || 0) * 100) / 100;
      if (Number(user?.saldo || 0) + 0.0001 < total) {
        problemasMedios.push({
          tipo: 'COMPRA_ACIMA_SALDO_ATUAL',
          ordemId: o.id,
          usuarioId: o.usuarioId,
          custo: total,
          saldoAtual: Number(user?.saldo || 0)
        });
      }
    }
  }

  const journalById = new Map(safeArray(journal).map((j) => [String(j.id), j]));
  for (const tx of safeArray(financeiro)) {
    const finalStatuses = ['CONFIRMADO', 'ESTORNADO', 'CANCELADO', 'FALHOU'];
    if (finalStatuses.includes(String(tx?.status || ''))) {
      const ids = safeArray(tx?.ledgerEntryIds);
      const found = ids.filter((id) => journalById.has(String(id)));
      if (found.length === 0) {
        problemasCriticos.push({
          tipo: 'FIN_TX_FINAL_SEM_LEDGER',
          transacaoId: tx.id,
          status: tx.status,
          gatewayReference: tx.gatewayReference || null
        });
      }
    }
  }

  const frozenUsers = Object.entries(antifraudeState?.users || {})
    .filter(([, v]) => Number(v?.frozenUntil || 0) > Date.now())
    .length;
  const frozenClubes = Object.entries(antifraudeState?.clubes || {})
    .filter(([, v]) => Number(v?.frozenUntil || 0) > Date.now())
    .length;

  if (safeArray(financeiro).filter((t) => ['PENDENTE', 'PROCESSANDO'].includes(String(t?.status || ''))).length > 50) {
    avisos.push({ tipo: 'MUITAS_TRANSACOES_PENDENTES' });
  }

  const statusGeral =
    problemasCriticos.length > 0 ? 'CRITICO' :
    problemasMedios.length > 0 ? 'ATENCAO' :
    'OK';

  return {
    statusGeral,
    resumo: {
      usuarios: safeArray(usuarios).length,
      ordensAbertas: safeArray(ordens).filter((o) => Number(o?.restante || 0) > 0).length,
      clubes: safeArray(clubes).length,
      investimentos: safeArray(investimentos).length,
      lancamentosLedger: safeArray(journal).length,
      transacoesFinanceiras: safeArray(financeiro).length,
      transacoesPendentes: safeArray(financeiro).filter((t) => ['PENDENTE', 'PROCESSANDO'].includes(String(t?.status || ''))).length,
      frozenUsers,
      frozenClubes
    },
    problemasCriticos,
    problemasMedios,
    avisos,
    flags: {
      betaMode: envBool('BETA_MODE', true),
      depositsEnabled: envBool('ENABLE_DEPOSITS', true),
      withdrawalsEnabled: envBool('ENABLE_WITHDRAWALS', true)
    }
  };
}

function buildHealthPayload() {
  const check = runSystemCheck();
  return {
    ok: check.statusGeral !== 'CRITICO',
    status: check.statusGeral,
    ts: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    resumo: check.resumo,
    flags: check.flags,
    criticos: check.problemasCriticos.length,
    medios: check.problemasMedios.length,
    avisos: check.avisos.length
  };
}

module.exports = {
  runSystemCheck,
  buildHealthPayload
};

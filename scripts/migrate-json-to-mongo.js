require('dotenv').config();
const path = require('path');
const fs = require('fs');

const { connectDB } = require('../config/db');

const User = require('../models/User');
const Club = require('../models/Club');
const Investment = require('../models/Investment');
const Order = require('../models/Order');
const FinancialTransaction = require('../models/FinancialTransaction');

const dataDir = path.join(__dirname, '..', 'data');

function readJson(fileName, fallback = []) {
  try {
    const full = path.join(dataDir, fileName);
    if (!fs.existsSync(full)) return fallback;
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    console.warn(`[migrate] erro lendo ${fileName}:`, e.message);
    return fallback;
  }
}

async function migrateUsers() {
  const usuarios = readJson('usuarios.json', []);
  const idMap = new Map();

  for (const u of usuarios) {
    const doc = await User.findOneAndUpdate(
      { legacyId: Number(u.id) },
      {
        $set: {
          legacyId: Number(u.id),
          nome: u.nome || '',
          sobrenome: u.sobrenome || '',
          nomeUsuario: u.nomeUsuario || `user_${u.id}`,
          email: u.email || `user_${u.id}@placeholder.local`,
          cpf: u.cpf || undefined,
          dataNascimento: u.dataNascimento || null,
          genero: u.genero || null,
          senha: u.senha || '',
          saldo: Number(u.saldo || 0),
          admin: String(u.admin) === 'true' || u.admin === true,
          role:
            String(u.admin) === 'true' || u.admin === true ? 'admin' : 'user',
          carteira: Array.isArray(u.carteira)
            ? u.carteira.map((a) => ({
                clubeId: Number(a.clubeId),
                nomeClube: a.nomeClube || '',
                quantidade: Number(a.quantidade || 0),
                precoMedio: Number(a.precoMedio || 0),
                totalInvestido: Number(
                  a.totalInvestido ||
                    Number(a.quantidade || 0) * Number(a.precoMedio || 0)
                ),
              }))
            : [],
          dadosBancarios: u.dadosBancarios || null,
          aceitesFinanceiros: u.aceitesFinanceiros || {},
          failedLoginAttempts: Number(u.failedLoginAttempts || 0),
          lockUntil: u.lockUntil || null,
          lastLoginAt: u.lastLoginAt || null,
          lastLoginIp: u.lastLoginIp || null,
          lastLoginUserAgent: u.lastLoginUserAgent || null,
          loginHistory: Array.isArray(u.loginHistory) ? u.loginHistory : [],
          watchlist: u.watchlist || { clubes: [], ligas: [] },
          notificacoes: Array.isArray(u.notificacoes) ? u.notificacoes : [],
          alertState: u.alertState || { clubPrices: {} },
          ledgerMirror: Array.isArray(u.ledgerMirror) ? u.ledgerMirror : [],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    idMap.set(String(u.id), doc._id);
  }

  return idMap;
}

async function migrateClubs() {
  const clubes = readJson('clubes.json', []);
  const idMap = new Map();

  for (const c of clubes) {
    const doc = await Club.findOneAndUpdate(
      { legacyId: Number(c.id) },
      {
        $set: {
          legacyId: Number(c.id),
          nome: c.nome || '',
          escudo: c.escudo || '',
          posicao: c.posicao ?? null,
          preco: Number(c.preco || 0),
          precoAtual:
            c.precoAtual != null ? Number(c.precoAtual) : null,
          cotasDisponiveis: Number(c.cotasDisponiveis || 0),
          cotasEmitidas: Number(c.cotasEmitidas || 0),
          ipoEncerrado: Boolean(c.ipoEncerrado),
          splitFactorCumulativo: Number(c.splitFactorCumulativo || 1),
          splits: Array.isArray(c.splits)
            ? c.splits.map((s) => ({
                ratio: Number(s.ratio || 1),
                data: s.data ? new Date(s.data) : new Date(),
                motivo: s.motivo || null,
              }))
            : [],
          travadoAte: Number(c.travadoAte || 0),
          metadata: {},
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    idMap.set(String(c.id), doc._id);
  }

  return idMap;
}

async function migrateInvestments(userMap, clubMap) {
  const investimentos = readJson('investimentos.json', []);

  for (const inv of investimentos) {
    const legacyId = inv.id != null ? String(inv.id) : undefined;
    const usuarioLegacyId = inv.usuarioId != null ? Number(inv.usuarioId) : null;
    const clubeLegacyId = inv.clubeId != null ? Number(inv.clubeId) : null;

    await Investment.findOneAndUpdate(
      { legacyId },
      {
        $set: {
          legacyId,
          usuarioId: userMap.get(String(usuarioLegacyId)),
          usuarioLegacyId,
          clubeId:
            clubeLegacyId != null ? clubMap.get(String(clubeLegacyId)) || null : null,
          clubeLegacyId,
          clubeNome: inv.clubeNome || '',
          quantidade: Number(inv.quantidade || 0),
          precoUnitario: Number(inv.precoUnitario || 0),
          valorUnitario: Number(inv.valorUnitario || inv.precoUnitario || 0),
          totalPago: Number(inv.totalPago || 0),
          tipo: inv.tipo || 'OPERACAO',
          origem: inv.origem || null,
          data: inv.data ? new Date(inv.data) : new Date(),
          metadata: {},
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
}

async function migrateOrders(userMap, clubMap) {
  const ordens = readJson('ordens.json', []);

  for (const o of ordens) {
    const legacyId = o.id != null ? String(o.id) : undefined;
    const usuarioLegacyId = o.usuarioId != null ? Number(o.usuarioId) : null;
    const clubeLegacyId = o.clubeId != null ? Number(o.clubeId) : null;

    let status = 'aberta';
    if (Number(o.restante || 0) <= 0) status = 'executada';
    if (o.status === 'cancelada') status = 'cancelada';
    if (Number(o.restante || 0) > 0 && Number(o.restante || 0) < Number(o.quantidade || 0)) {
      status = 'parcial';
    }

    await Order.findOneAndUpdate(
      { legacyId },
      {
        $set: {
          legacyId,
          usuarioId: userMap.get(String(usuarioLegacyId)),
          usuarioLegacyId,
          clubeId: clubMap.get(String(clubeLegacyId)),
          clubeLegacyId,
          tipo: o.tipo,
          preco: Number(o.preco || 0),
          quantidade: Number(o.quantidade || 0),
          restante: Number(o.restante || 0),
          status,
          criadoEm: o.criadoEm ? new Date(o.criadoEm) : new Date(),
          canceladoEm: o.canceladoEm ? new Date(o.canceladoEm) : null,
          executadoEm: o.executadoEm ? new Date(o.executadoEm) : null,
          metadata: {},
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
}

async function migrateFinancialTransactions(userMap) {
  const list = readJson('financeiro_transacoes.json', []);

  for (const tx of list) {
    const legacyId = tx.id != null ? String(tx.id) : undefined;
    const usuarioLegacyId = tx.usuarioId != null ? Number(tx.usuarioId) : null;

    await FinancialTransaction.findOneAndUpdate(
      { legacyId },
      {
        $set: {
          legacyId,
          usuarioId: userMap.get(String(usuarioLegacyId)),
          usuarioLegacyId,
          tipo: tx.tipo,
          valorBruto: Number(tx.valorBruto || 0),
          taxa: Number(tx.taxa || 0),
          valorLiquido:
            tx.valorLiquido != null ? Number(tx.valorLiquido) : null,
          gateway: tx.gateway || 'manual',
          gatewayReference: tx.gatewayReference || null,
          status: tx.status || 'PENDENTE',
          reconciliacaoStatus: tx.reconciliacaoStatus || null,
          reconciliadoEm: tx.reconciliadoEm ? new Date(tx.reconciliadoEm) : null,
          ledgerEntryIds: Array.isArray(tx.ledgerEntryIds) ? tx.ledgerEntryIds : [],
          metadata: tx.metadata || {},
          createdAt: tx.createdAt ? new Date(tx.createdAt) : new Date(),
          updatedAt: tx.updatedAt ? new Date(tx.updatedAt) : new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
}

async function main() {
  await connectDB();

  console.log('[migrate] iniciando usuários...');
  const userMap = await migrateUsers();

  console.log('[migrate] iniciando clubes...');
  const clubMap = await migrateClubs();

  console.log('[migrate] iniciando investimentos...');
  await migrateInvestments(userMap, clubMap);

  console.log('[migrate] iniciando ordens...');
  await migrateOrders(userMap, clubMap);

  console.log('[migrate] iniciando transações financeiras...');
  await migrateFinancialTransactions(userMap);

  console.log('[migrate] concluído com sucesso.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] erro fatal:', err);
  process.exit(1);
});
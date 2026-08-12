const crypto = require('crypto');

const INITIAL_BALANCE = 1000;
const RESET_CONFIRMATION = 'RESETAR_AMBIENTE_DE_TESTES';
const RESTORE_CONFIRMATION = 'RESTAURAR_BACKUP_DE_TESTES';
const MANIFEST_COLLECTION = 'test_reset_manifests';
const LOCK_COLLECTION = 'test_environment_operation_locks';

const CLEARED_COLLECTIONS = [
  'orders',
  'investments',
  'financial_transactions',
  'ledger_entries',
  'ledger_idempotency',
  'liquidacoes',
  'dividendos',
  'historico_posse',
  'top4_rodadas',
  'performance_snapshots',
  'weekly_performance_reports',
  'recovery_recharges',
  'trophies',
  'trophy_award_states',
  'user_round_usage',
  'user_trading_quotas',
  'admin_metric_snapshots',
  'advanced_alert_triggers',
  'institutional_daily_limits',
  'institutional_liquidity',
  'social_feed_events',
  'antifraude_logs',
  'antifraude_state',
  'audit_logs',
];

const UPDATED_COLLECTIONS = [
  'users',
  'clubs',
  'advanced_alerts',
  'private_ranking_members',
  'market_liquidity_settings',
];

const BACKED_UP_COLLECTIONS = [...UPDATED_COLLECTIONS, ...CLEARED_COLLECTIONS];
const RESTORABLE_STATUSES = new Set([
  'BACKUP_COMPLETE',
  'RESET_COMPLETE',
  'RESET_FAILED',
  'RESET_VERIFICATION_FAILED',
]);

function operationError(message, status = 500, code = 'TEST_ENVIRONMENT_OPERATION_FAILED') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function backupIdFor(date = new Date()) {
  const timestamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  return `${timestamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function backupCollectionName(backupId, collectionName) {
  return `test_reset_backup_${backupId}__${collectionName}`;
}

function humanUserFilter() {
  return { 'metadata.accountType': { $ne: 'INSTITUTIONAL' } };
}

function institutionalUserFilter() {
  return { 'metadata.accountType': 'INSTITUTIONAL' };
}

async function existingCollectionNames(db) {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  return new Set(collections.map((item) => item.name));
}

async function countIfExists(db, existing, collectionName, filter = {}) {
  if (!existing.has(collectionName)) return 0;
  return db.collection(collectionName).countDocuments(filter);
}

async function findActiveSeason(db, existing) {
  if (!existing.has('ranking_seasons')) return null;
  const active = await db
    .collection('ranking_seasons')
    .find({ status: 'ativa' })
    .sort({ iniciadaEm: -1, createdAt: -1 })
    .limit(2)
    .toArray();

  if (active.length > 1) {
    throw operationError(
      'Há mais de uma temporada ativa. Corrija isso antes do reset.',
      409,
      'MULTIPLE_ACTIVE_SEASONS'
    );
  }

  return active[0] || null;
}

async function collectPreview(db) {
  const existing = await existingCollectionNames(db);
  const season = await findActiveSeason(db, existing);
  const countEntries = await Promise.all(
    BACKED_UP_COLLECTIONS.map(async (collectionName) => [
      collectionName,
      await countIfExists(db, existing, collectionName),
    ])
  );
  const counts = Object.fromEntries(countEntries);

  const [pendingRecoveryPayments, pendingFinancialTransactions] = await Promise.all([
    countIfExists(db, existing, 'recovery_recharges', {
      status: { $in: ['PENDENTE', 'PROCESSANDO'] },
    }),
    countIfExists(db, existing, 'financial_transactions', {
      status: { $in: ['PENDENTE', 'PROCESSANDO', 'EM_PROCESSAMENTO'] },
    }),
  ]);
  const pendingPayments = pendingRecoveryPayments + pendingFinancialTransactions;

  return {
    database: db.databaseName,
    season: season
      ? { id: String(season._id), codigo: season.codigo, nome: season.nome }
      : null,
    humanUsers: await countIfExists(db, existing, 'users', humanUserFilter()),
    institutionalUsers: await countIfExists(db, existing, 'users', institutionalUserFilter()),
    clubs: await countIfExists(db, existing, 'clubs'),
    pendingPayments,
    pendingRecoveryPayments,
    pendingFinancialTransactions,
    counts,
  };
}

async function copyCollection(db, sourceName, targetName, existing) {
  if (!existing.has(sourceName)) return 0;

  const cursor = db.collection(sourceName).find({}).batchSize(250);
  const target = db.collection(targetName);
  let batch = [];
  let total = 0;

  for await (const document of cursor) {
    batch.push({ _id: document._id, document });
    if (batch.length >= 250) {
      await target.insertMany(batch, { ordered: true });
      total += batch.length;
      batch = [];
    }
  }

  if (batch.length) {
    await target.insertMany(batch, { ordered: true });
    total += batch.length;
  }

  return total;
}

async function createBackup(db, backupId, preview, actorUserId = null) {
  const existing = await existingCollectionNames(db);
  const manifestCollection = db.collection(MANIFEST_COLLECTION);
  const collections = {};

  await manifestCollection.insertOne({
    _id: backupId,
    type: 'TEST_ENVIRONMENT_RESET',
    status: 'BACKING_UP',
    database: db.databaseName,
    createdAt: new Date(),
    createdBy: actorUserId,
    preview,
    collections,
  });

  try {
    for (const sourceName of BACKED_UP_COLLECTIONS) {
      const targetName = backupCollectionName(backupId, sourceName);
      const count = await copyCollection(db, sourceName, targetName, existing);
      collections[sourceName] = { backupCollection: targetName, count };
      await manifestCollection.updateOne(
        { _id: backupId },
        { $set: { [`collections.${sourceName}`]: collections[sourceName] } }
      );
    }

    await manifestCollection.updateOne(
      { _id: backupId },
      { $set: { status: 'BACKUP_COMPLETE', backupCompletedAt: new Date() } }
    );
    return collections;
  } catch (error) {
    await manifestCollection.updateOne(
      { _id: backupId },
      { $set: { status: 'BACKUP_FAILED', failedAt: new Date(), error: error.message } }
    );
    throw error;
  }
}

async function clearCollectionIfExists(db, existing, collectionName) {
  if (!existing.has(collectionName)) return 0;
  const result = await db.collection(collectionName).deleteMany({});
  return result.deletedCount || 0;
}

async function applyReset(db, preview, backupId, actorUserId = null) {
  const existing = await existingCollectionNames(db);
  const now = new Date();
  const seasonCode = preview.season?.codigo || null;
  const results = { cleared: {}, updated: {} };

  for (const collectionName of CLEARED_COLLECTIONS) {
    results.cleared[collectionName] = await clearCollectionIfExists(
      db,
      existing,
      collectionName
    );
  }

  if (existing.has('users')) {
    const humans = await db.collection('users').updateMany(
      humanUserFilter(),
      {
        $set: {
          capitalInicial: INITIAL_BALANCE,
          saldo: INITIAL_BALANCE,
          carteira: [],
          historico: [],
          transacoes: [],
          temporadaRanking: seasonCode,
          patrimonioInicialTemporada: INITIAL_BALANCE,
          saldoInicialTemporada: INITIAL_BALANCE,
          inicioTemporadaRanking: now,
          rankingPerformance: {
            versao: 1,
            temporadaChave: seasonCode,
            fatorFechado: 1,
            patrimonioReferencia: INITIAL_BALANCE,
            aportesExternosTotal: 0,
            ultimaMovimentacaoExternaEm: null,
          },
          notificacoes: [],
          alertState: { clubPrices: {} },
          ledgerMirror: [],
          updatedAt: now,
        },
      }
    );

    const institutional = await db.collection('users').updateMany(
      institutionalUserFilter(),
      {
        $set: {
          capitalInicial: 0,
          saldo: 0,
          carteira: [],
          historico: [],
          transacoes: [],
          temporadaRanking: null,
          patrimonioInicialTemporada: null,
          saldoInicialTemporada: null,
          inicioTemporadaRanking: null,
          rankingPerformance: {
            versao: 1,
            temporadaChave: null,
            fatorFechado: 1,
            patrimonioReferencia: 0,
            aportesExternosTotal: 0,
            ultimaMovimentacaoExternaEm: null,
          },
          rankingAtivo: false,
          notificacoes: [],
          alertState: { clubPrices: {} },
          ledgerMirror: [],
          updatedAt: now,
        },
      }
    );

    results.updated.users = {
      human: humans.modifiedCount || 0,
      institutional: institutional.modifiedCount || 0,
    };
  }

  if (existing.has('clubs')) {
    const clubs = await db.collection('clubs').updateMany(
      {},
      [
        {
          $set: {
            precoAtual: { $ifNull: ['$preco', 0] },
            cotasDisponiveis: 1000,
            cotasEmitidas: 0,
            ipoEncerrado: false,
            splitFactorCumulativo: 1,
            splits: [],
            travadoAte: 0,
            updatedAt: now,
          },
        },
      ]
    );
    results.updated.clubs = clubs.modifiedCount || 0;
  }

  if (existing.has('advanced_alerts')) {
    const removedOrderAlerts = await db.collection('advanced_alerts').deleteMany({
      ordemId: { $exists: true, $ne: null },
    });
    const alerts = await db.collection('advanced_alerts').updateMany(
      {},
      {
        $set: {
          valorBase: null,
          ultimoDisparoEm: null,
          ultimoEstado: {},
          updatedAt: now,
        },
      }
    );
    results.updated.advancedAlerts = {
      orderAlertsRemoved: removedOrderAlerts.deletedCount || 0,
      reset: alerts.modifiedCount || 0,
    };
  }

  if (existing.has('private_ranking_members')) {
    const members = await db.collection('private_ranking_members').updateMany(
      {},
      { $set: { trofeus: [], updatedAt: now } }
    );
    results.updated.privateRankingMembers = members.modifiedCount || 0;
  }

  if (existing.has('market_liquidity_settings')) {
    const settings = await db.collection('market_liquidity_settings').updateMany(
      {},
      {
        $set: {
          lastGlobalRepriceAt: null,
          lastGlobalRepriceRound: null,
          updatedAt: now,
        },
      }
    );
    results.updated.marketLiquiditySettings = settings.modifiedCount || 0;
  }

  await db.collection('audit_logs').insertOne({
    id: `test-reset-${backupId}`,
    kind: 'ADMIN',
    action: 'TEST_ENVIRONMENT_RESET',
    userId: actorUserId,
    entityType: 'TestEnvironment',
    entityId: backupId,
    meta: {
      backupId,
      humanUsers: preview.humanUsers,
      clubs: preview.clubs,
      seasonCode,
    },
    ts: now,
  });

  return results;
}

async function verifyReset(db, preview) {
  const existing = await existingCollectionNames(db);
  const failures = [];

  if (existing.has('users')) {
    const invalidHumans = await db.collection('users').countDocuments({
      ...humanUserFilter(),
      $or: [
        { saldo: { $ne: INITIAL_BALANCE } },
        { capitalInicial: { $ne: INITIAL_BALANCE } },
        { 'carteira.0': { $exists: true } },
        { 'historico.0': { $exists: true } },
        { 'transacoes.0': { $exists: true } },
        { 'rankingPerformance.fatorFechado': { $ne: 1 } },
        { 'rankingPerformance.aportesExternosTotal': { $ne: 0 } },
      ],
    });
    if (invalidHumans) failures.push(`${invalidHumans} conta(s) humana(s) não foram zeradas.`);

    const invalidInstitutional = await db.collection('users').countDocuments({
      ...institutionalUserFilter(),
      $or: [{ saldo: { $ne: 0 } }, { 'carteira.0': { $exists: true } }],
    });
    if (invalidInstitutional) {
      failures.push(`${invalidInstitutional} conta(s) institucional(is) ficaram inconsistentes.`);
    }
  }

  if (existing.has('clubs')) {
    const invalidClubs = await db.collection('clubs').countDocuments({
      $or: [
        { cotasDisponiveis: { $ne: 1000 } },
        { cotasEmitidas: { $ne: 0 } },
        { ipoEncerrado: { $ne: false } },
        { splitFactorCumulativo: { $ne: 1 } },
        { 'splits.0': { $exists: true } },
        { $expr: { $ne: ['$precoAtual', '$preco'] } },
      ],
    });
    if (invalidClubs) failures.push(`${invalidClubs} clube(s) não foram reinicializados.`);
  }

  for (const collectionName of CLEARED_COLLECTIONS) {
    if (collectionName === 'audit_logs') continue;
    const count = await countIfExists(db, existing, collectionName);
    if (count) failures.push(`${collectionName} ainda contém ${count} documento(s).`);
  }

  const auditCount = await countIfExists(db, existing, 'audit_logs', {
    id: `test-reset-${preview.backupId}`,
  });
  if (auditCount !== 1) failures.push('O registro de auditoria do reset não foi criado corretamente.');

  return { ok: failures.length === 0, failures };
}

async function acquireOperationLock(db, type, actorUserId = null) {
  const now = new Date();
  const token = crypto.randomUUID();

  try {
    await db.collection(LOCK_COLLECTION).findOneAndUpdate(
      {
        _id: 'global',
        $or: [{ expiresAt: { $lte: now } }, { expiresAt: { $exists: false } }],
      },
      {
        $set: {
          token,
          type,
          actorUserId,
          startedAt: now,
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (error) {
    if (error?.code === 11000) {
      throw operationError(
        'Já existe um reset ou uma restauração em andamento.',
        409,
        'TEST_ENVIRONMENT_OPERATION_IN_PROGRESS'
      );
    }
    throw error;
  }

  return token;
}

async function releaseOperationLock(db, token) {
  await db.collection(LOCK_COLLECTION).deleteOne({ _id: 'global', token });
}

async function resetTestEnvironment(db, { confirmation, actorUserId = null } = {}) {
  if (confirmation !== RESET_CONFIRMATION) {
    throw operationError('Confirmação inválida para o reset.', 400, 'INVALID_RESET_CONFIRMATION');
  }

  const lockToken = await acquireOperationLock(db, 'RESET', actorUserId);
  let backupId = null;

  try {
    const preview = await collectPreview(db);
    if (preview.pendingPayments > 0) {
      throw operationError(
        `Existem ${preview.pendingPayments} pagamentos pendentes ou em processamento. Resolva-os antes do reset.`,
        409,
        'PENDING_RECOVERY_PAYMENTS'
      );
    }

    backupId = backupIdFor();
    preview.backupId = backupId;
    await createBackup(db, backupId, preview, actorUserId);

    try {
      const results = await applyReset(db, preview, backupId, actorUserId);
      const verification = await verifyReset(db, preview);

      await db.collection(MANIFEST_COLLECTION).updateOne(
        { _id: backupId },
        {
          $set: {
            status: verification.ok ? 'RESET_COMPLETE' : 'RESET_VERIFICATION_FAILED',
            resetCompletedAt: new Date(),
            results,
            verification,
          },
        }
      );

      if (!verification.ok) {
        throw operationError(
          `A verificação encontrou inconsistências: ${verification.failures.join(' ')}`,
          500,
          'RESET_VERIFICATION_FAILED'
        );
      }

      return { backupId, preview, results, verification };
    } catch (error) {
      await db.collection(MANIFEST_COLLECTION).updateOne(
        { _id: backupId },
        {
          $set: {
            status: error.code === 'RESET_VERIFICATION_FAILED'
              ? 'RESET_VERIFICATION_FAILED'
              : 'RESET_FAILED',
            resetFailedAt: new Date(),
            error: error.message,
          },
        }
      );
      throw error;
    }
  } finally {
    await releaseOperationLock(db, lockToken).catch(() => {});
  }
}

function validateBackupCollectionName(backupId, sourceName, backupName) {
  const expected = backupCollectionName(backupId, sourceName);
  if (backupName !== expected) {
    throw operationError(
      `Referência de backup inválida para ${sourceName}.`,
      409,
      'INVALID_BACKUP_REFERENCE'
    );
  }
}

async function restoreCollection(db, sourceName, backupName) {
  const cursor = db.collection(backupName).find({}).batchSize(250);
  await db.collection(sourceName).deleteMany({});

  let batch = [];
  let total = 0;
  for await (const wrapper of cursor) {
    batch.push(wrapper.document);
    if (batch.length >= 250) {
      await db.collection(sourceName).insertMany(batch, { ordered: true });
      total += batch.length;
      batch = [];
    }
  }

  if (batch.length) {
    await db.collection(sourceName).insertMany(batch, { ordered: true });
    total += batch.length;
  }

  return total;
}

async function restoreTestEnvironment(
  db,
  { backupId, confirmation, actorUserId = null } = {}
) {
  if (confirmation !== RESTORE_CONFIRMATION) {
    throw operationError(
      'Confirmação inválida para a restauração.',
      400,
      'INVALID_RESTORE_CONFIRMATION'
    );
  }
  if (!backupId || typeof backupId !== 'string') {
    throw operationError('Selecione um backup válido.', 400, 'BACKUP_ID_REQUIRED');
  }

  const lockToken = await acquireOperationLock(db, 'RESTORE', actorUserId);

  try {
    const manifest = await db.collection(MANIFEST_COLLECTION).findOne({ _id: backupId });
    if (!manifest) {
      throw operationError('Backup não encontrado.', 404, 'BACKUP_NOT_FOUND');
    }
    if (!RESTORABLE_STATUSES.has(manifest.status)) {
      throw operationError(
        `Este backup não pode ser restaurado no status ${manifest.status}.`,
        409,
        'BACKUP_NOT_RESTORABLE'
      );
    }

    const restored = {};
    for (const [sourceName, item] of Object.entries(manifest.collections || {})) {
      validateBackupCollectionName(backupId, sourceName, item.backupCollection);
      restored[sourceName] = await restoreCollection(db, sourceName, item.backupCollection);
    }

    const restoredAt = new Date();
    await db.collection(MANIFEST_COLLECTION).updateOne(
      { _id: backupId },
      {
        $set: {
          status: 'RESTORED',
          restoredAt,
          restoredBy: actorUserId,
          restored,
        },
      }
    );

    await db.collection('audit_logs').insertOne({
      id: `test-restore-${backupId}-${Date.now()}`,
      kind: 'ADMIN',
      action: 'TEST_ENVIRONMENT_BACKUP_RESTORED',
      userId: actorUserId,
      entityType: 'TestEnvironment',
      entityId: backupId,
      meta: { backupId },
      ts: restoredAt,
    });

    return { backupId, restoredAt, restored };
  } finally {
    await releaseOperationLock(db, lockToken).catch(() => {});
  }
}

async function listBackups(db, limit = 20) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const manifests = await db
    .collection(MANIFEST_COLLECTION)
    .find({ type: 'TEST_ENVIRONMENT_RESET' })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .project({
      _id: 1,
      status: 1,
      createdAt: 1,
      createdBy: 1,
      restoredAt: 1,
      preview: 1,
    })
    .toArray();

  return manifests.map((item) => ({
    id: String(item._id),
    status: item.status,
    createdAt: item.createdAt,
    createdBy: item.createdBy || null,
    restoredAt: item.restoredAt || null,
    canRestore: RESTORABLE_STATUSES.has(item.status),
    summary: {
      humanUsers: Number(item.preview?.humanUsers || 0),
      clubs: Number(item.preview?.clubs || 0),
      season: item.preview?.season || null,
    },
  }));
}

module.exports = {
  BACKED_UP_COLLECTIONS,
  CLEARED_COLLECTIONS,
  INITIAL_BALANCE,
  RESET_CONFIRMATION,
  RESTORE_CONFIRMATION,
  backupCollectionName,
  backupIdFor,
  collectPreview,
  humanUserFilter,
  institutionalUserFilter,
  listBackups,
  resetTestEnvironment,
  restoreTestEnvironment,
};

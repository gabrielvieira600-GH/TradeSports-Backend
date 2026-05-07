// backend/utils/audit.js
const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(

  {

    id: { type: String, index: true, unique: true, sparse: true },

    kind: { type: String, default: 'APP', index: true },

    action: { type: String, required: true, index: true },

    userId: { type: String, default: null, index: true },

    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    actorLegacyId: { type: Number, default: null, index: true },

    entityType: { type: String, default: null, index: true },

    entityId: { type: String, default: null, index: true },

    ip: { type: String, default: null },

    userAgent: { type: String, default: null },

    txAction: { type: String, default: null },

    snapshot: { type: String, default: null },

    inv: { type: mongoose.Schema.Types.Mixed, default: null },

    error: { type: String, default: null },

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    ts: { type: Date, default: Date.now, index: true },

  },

  {

    collection: 'audit_logs',

    versionKey: false,

  }

);

const AuditLog =

  mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);

async function logEvent(evt = {}, session = null) {

  const entry = {

    id: evt.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,

    ts: evt.ts ? new Date(evt.ts) : new Date(),

    ...evt,

  };

  try {

    if (session) {

      const docs = await AuditLog.create([entry], { session });

      return docs[0].toObject();

    }

    const doc = await AuditLog.create(entry);

    return doc.toObject();

  } catch (err) {

    console.error('[AUDIT] erro ao gravar log:', err.message);

    return entry;

  }

}

async function readRecent(limit = 50, filter = {}) {

  const lim = Math.max(1, Math.min(1000, Number(limit) || 50));

  return AuditLog.find(filter).sort({ ts: -1 }).limit(lim).lean();

}

module.exports = { logEvent, readRecent, AuditLog };
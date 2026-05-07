// backend/utils/tx.js
const mongoose = require('mongoose');

const User = require('../models/User');

const Order = require('../models/Order');

function round2(n) {

  return Math.round(Number(n || 0) * 100) / 100;

}

async function validateInvariants(session) {

  const usuarios = await User.find({}, { saldo: 1, carteira: 1 }).session(session).lean();

  for (const u of usuarios) {

    if (Number(u.saldo || 0) < 0) {

      return { ok: false, reason: 'SALDO_NEGATIVO', userId: String(u._id), saldo: u.saldo };

    }

    if (Array.isArray(u.carteira)) {

      for (const a of u.carteira) {

        if (Number(a.quantidade || 0) < 0) {

          return {

            ok: false,

            reason: 'CARTEIRA_QTD_NEGATIVA',

            userId: String(u._id),

            clubeId: a.clubeId,

            quantidade: a.quantidade,

          };

        }

        if (Number(a.totalInvestido || 0) < 0) {

          return {

            ok: false,

            reason: 'CARTEIRA_INV_NEGATIVO',

            userId: String(u._id),

            clubeId: a.clubeId,

            totalInvestido: a.totalInvestido,

          };

        }

      }

    }

  }

  try {

    const ordens = await Order.find({}, { quantidade: 1, restante: 1 }).session(session).lean();

    for (const o of ordens) {

      if (Number(o.quantidade || 0) < 0) {

        return { ok: false, reason: 'ORDEM_QTD_NEGATIVA', ordemId: String(o._id) };

      }

      if (Number(o.restante || 0) < 0) {

        return { ok: false, reason: 'ORDEM_RESTANTE_NEGATIVO', ordemId: String(o._id) };

      }

    }

  } catch (_) {

    // ordem pode não existir/ser usada neste fluxo

  }

  return { ok: true };

}

async function runTx({ action = 'TX', meta = {}, mutate }) {

  const session = await mongoose.startSession();

  try {

    let result;

    await session.withTransaction(

      async () => {

        result = await mutate(session);

        const inv = await validateInvariants(session);

        if (!inv.ok) {

          const err = new Error(`Invariante falhou: ${inv.reason}`);

          err.code = 'INVARIANT_FAIL';

          err.inv = inv;

          throw err;

        }

      },

      {

        readConcern: { level: 'snapshot' },

        writeConcern: { w: 'majority' },

        readPreference: 'primary',

      }

    );

    return result;

  } finally {

    await session.endSession();

  }

}

module.exports = { runTx, validateInvariants, round2 };
// utils/usuarioService.js
const mongoose = require('mongoose');
const User = require('../models/User');

function toLegacyUserObject(user) {
  if (!user) return null;

  const obj = user.toObject ? user.toObject() : user;

  return {
    ...obj,
    id: obj.legacyId != null ? obj.legacyId : String(obj._id),
    _id: obj._id,
  };
}

async function buscarUsuarioPorId(id) {
  if (!id) return null;

  const idStr = String(id);

  const usuario = mongoose.Types.ObjectId.isValid(idStr)
    ? await User.findById(idStr).lean()
    : await User.findOne({ legacyId: Number(idStr) }).lean();

  return toLegacyUserObject(usuario);
}

async function lerUsuarios() {
  const usuarios = await User.find({}).lean();
  return usuarios.map(toLegacyUserObject);
}

/**
 * Compatibilidade legada.
 *
 * No JSON antigo, salvarUsuarios recebia a lista inteira e sobrescrevia o arquivo.
 * Em Mongo, essa operação é perigosa. Por compatibilidade, fazemos upsert dos usuários
 * recebidos, sem apagar documentos ausentes.
 */
async function salvarUsuarios(usuarios = []) {
  if (!Array.isArray(usuarios)) {
    throw new Error('salvarUsuarios espera um array de usuários.');
  }

  const ops = [];

  for (const u of usuarios) {
    if (!u) continue;

    const legacyId =
      u.legacyId != null
        ? Number(u.legacyId)
        : u.id != null && !mongoose.Types.ObjectId.isValid(String(u.id))
          ? Number(u.id)
          : null;

    const filter = u._id && mongoose.Types.ObjectId.isValid(String(u._id))
      ? { _id: u._id }
      : legacyId != null && Number.isFinite(legacyId)
        ? { legacyId }
        : u.email
          ? { email: String(u.email).trim().toLowerCase() }
          : null;

    if (!filter) continue;

    const payload = {
      ...u,
      email: u.email ? String(u.email).trim().toLowerCase() : u.email,
    };

    delete payload.id;
    delete payload._id;

    if (legacyId != null && Number.isFinite(legacyId)) {
      payload.legacyId = legacyId;
    }

    ops.push({
      updateOne: {
        filter,
        update: { $set: payload },
        upsert: true,
      },
    });
  }

  if (!ops.length) return true;

  await User.bulkWrite(ops, { ordered: false });
  return true;
}

module.exports = {
  lerUsuarios,
  salvarUsuarios,
  buscarUsuarioPorId,
};
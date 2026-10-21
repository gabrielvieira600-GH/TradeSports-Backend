const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Sub = require('../models/AsaasSubscription');
const { onlyDigits, validCpf, maskCpf } = require('../utils/cpf');

const router = express.Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde 15 minutos.' },
});

router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.usuario.id).select('cpf').lean();
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    return res.set('Cache-Control', 'no-store').json({
      cpfMascarado: maskCpf(user.cpf),
      cpfCadastrado: Boolean(user.cpf),
      cpfValido: validCpf(user.cpf),
    });
  } catch (err) {
    console.error('[BILLING PROFILE] consulta', { name: err.name, code: err.code || null });
    return res.status(500).json({ erro: 'Não foi possível consultar o CPF.' });
  }
});

router.put('/', auth, limiter, async (req, res) => {
  let etapa = 'validacao';
  try {
    const cpf = onlyDigits(req.body?.cpf);
    const senha = req.body?.senhaAtual;
    if (!validCpf(cpf)) return res.status(422).json({ erro: 'CPF inválido. Confira os dígitos verificadores.' });
    if (typeof senha !== 'string' || !senha) return res.status(422).json({ erro: 'Informe sua senha atual.' });

    etapa = 'buscar_usuario';
    const user = await User.findById(req.usuario.id).select('senha cpf').lean();
    if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    etapa = 'verificar_senha';
    if (typeof user.senha !== 'string' || !/^\$2[aby]\$\d\d\$/.test(user.senha)) {
      console.warn('[BILLING PROFILE] senha armazenada não é hash bcrypt reconhecido');
      return res.status(409).json({ erro: 'Não foi possível validar sua senha. Redefina a senha da conta e tente novamente.' });
    }
    if (!(await bcrypt.compare(senha, user.senha))) return res.status(403).json({ erro: 'Senha atual incorreta.' });

    if (onlyDigits(user.cpf) === cpf) return res.set('Cache-Control', 'no-store').json({ ok: true, cpfMascarado: maskCpf(cpf), cpfValido: true });

    etapa = 'verificar_duplicidade';
    if (await User.exists({ _id: { $ne: user._id }, cpf })) {
      return res.status(409).json({ erro: 'Este CPF já está cadastrado em outra conta.' });
    }

    etapa = 'verificar_assinatura';
    const subscription = await Sub.findOne({
      userId: user._id,
      customerId: { $exists: true, $nin: ['', null] },
    }).select('_id').lean();
    if (subscription) {
      return res.status(409).json({ erro: 'Este CPF já está associado a um cliente no Asaas. Entre em contato com o suporte para sincronizar os cadastros.' });
    }

    etapa = 'salvar_cpf';
    // Atualiza somente o CPF, sem executar os hooks pre('save') do documento User.
    // Evita validações e transformações de campos não relacionados à alteração.
    const updated = await User.updateOne({ _id: user._id }, { $set: { cpf } }, { runValidators: true });
    if (!updated.matchedCount) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    return res.set('Cache-Control', 'no-store').json({ ok: true, cpfMascarado: maskCpf(cpf), cpfValido: true });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ erro: 'Este CPF já está em uso.' });
    // Não registrar CPF, senha ou conteúdo da requisição.
    console.error('[BILLING PROFILE] falha', { etapa, nome: err.name, codigo: err.code || null, mensagem: err.message });
    return res.status(500).json({ erro: 'Falha interna ao atualizar CPF. Consulte o log BILLING PROFILE do Render.' });
  }
});

module.exports = router;

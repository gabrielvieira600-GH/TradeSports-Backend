const User = require('../models/User');

const {
  obterResumoDoPlano,
} = require('../utils/planFeatures');

async function requirePremium(req, res, next) {
  try {
    const usuarioId =
      req.usuario?.id ||
      req.usuario?._id;

    if (!usuarioId) {
      return res.status(401).json({
        erro: 'Usuário não autenticado.',
        codigo: 'USUARIO_NAO_AUTENTICADO',
      });
    }

    const usuario = await User.findById(
      usuarioId
    )
      .select(
        [
          '_id',
          'plano',
          'premiumAtivo',
          'premiumInicio',
          'premiumFim',
        ].join(' ')
      )
      .lean();

    if (!usuario) {
      return res.status(404).json({
        erro: 'Usuário não encontrado.',
        codigo: 'USUARIO_NAO_ENCONTRADO',
      });
    }

    const resumoPlano =
      obterResumoDoPlano(usuario);

    if (!resumoPlano.premiumAtivo) {
      return res.status(403).json({
        erro:
          'Esta funcionalidade está disponível apenas no plano Premium.',

        codigo:
          'PREMIUM_NECESSARIO',

        plano:
          resumoPlano.plano,

        premiumAtivo:
          resumoPlano.premiumAtivo,

        premiumFim:
          resumoPlano.premiumFim,
      });
    }

    req.planoUsuario = resumoPlano;
    req.usuarioPlano = usuario;

    return next();
  } catch (err) {
    console.error(
      'Erro ao validar acesso Premium:',
      err
    );

    return res.status(500).json({
      erro:
        'Erro interno ao validar o plano do usuário.',

      codigo:
        'ERRO_VALIDACAO_PLANO',
    });
  }
}

module.exports = requirePremium;
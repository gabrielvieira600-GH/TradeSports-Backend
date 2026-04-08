const mongoose = require('mongoose');

const LiquidacaoSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Usuario',
      required: true,
      index: true,
    },

    clubeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clube',
      required: true,
      index: true,
    },

    campeonato: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    temporada: {
      type: Number,
      required: true,
      index: true,
    },

    posicaoFinal: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
    },

    quantidade: {
      type: Number,
      required: true,
      min: 0,
    },

    /**
     * Preço-base da liquidação antes de qualquer ajuste por split.
     * Exemplo:
     * 1º lugar = 12.63
     */
    precoLiquidacaoBase: {
      type: Number,
      required: true,
      min: 0,
    },

    /**
     * Fator acumulado de split aplicado ao clube no momento da liquidação.
     * Ex.: 1, 2, 4 etc.
     */
    splitFactorCumulativo: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },

    /**
     * Preço efetivamente pago por cota após ajuste por split.
     * Exemplo:
     * precoLiquidacaoBase = 12.63
     * splitFactorCumulativo = 2
     * precoLiquidacao = 6.315
     */
    precoLiquidacao: {
      type: Number,
      required: true,
      min: 0,
    },

    /**
     * Valor total recebido pelo usuário nesta liquidação.
     * quantidade * precoLiquidacao
     */
    totalRecebido: {
      type: Number,
      required: true,
      min: 0,
    },

    /**
     * Saldo do usuário antes da liquidação.
     */
    saldoAntes: {
      type: Number,
      min: 0,
      default: 0,
    },

    /**
     * Saldo do usuário após a liquidação.
     */
    saldoDepois: {
      type: Number,
      min: 0,
      default: 0,
    },

    /**
     * Quantidade de cotas do usuário antes da liquidação.
     * Serve para auditoria/conferência.
     */
    quantidadeAntesLiquidacao: {
      type: Number,
      min: 0,
      default: 0,
    },

    /**
     * Quantidade após liquidação.
     * Normalmente será 0.
     */
    quantidadeDepoisLiquidacao: {
      type: Number,
      min: 0,
      default: 0,
    },

    /**
     * Referência opcional ao lançamento no ledger/journal.
     */
    ledgerEntryId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },

    /**
     * Chave idempotente para impedir duplicidade de liquidação.
     */
    idemKey: {
      type: String,
      trim: true,
      required: true,
      unique: true,
      index: true,
    },

    /**
     * Status da liquidação para auditoria operacional.
     */
    status: {
      type: String,
      enum: ['processada', 'revertida'],
      default: 'processada',
      index: true,
    },

    /**
     * Metadados livres para rastreabilidade futura.
     */
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    /**
     * Momento lógico/econômico da liquidação.
     */
    dataLiquidacao: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * Índice útil para consultas por campeonato/temporada/clube/usuário
 */
LiquidacaoSchema.index({
  campeonato: 1,
  temporada: 1,
  clubeId: 1,
  usuarioId: 1,
});

/**
 * Índice útil para relatórios operacionais
 */
LiquidacaoSchema.index({
  dataLiquidacao: -1,
  status: 1,
});

module.exports =
  mongoose.models.Liquidacao ||
  mongoose.model('Liquidacao', LiquidacaoSchema);
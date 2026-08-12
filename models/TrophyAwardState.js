const mongoose = require('mongoose');

const TrophyAwardStateSchema = new mongoose.Schema(
  {
    temporadaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RankingSeason',
      required: true,
      index: true,
    },

    periodoTipo: {
      type: String,
      enum: ['semana', 'mes'],
      required: true,
    },

    periodoAbertoChave: {
      type: String,
      required: true,
      trim: true,
    },

    periodoPendenteChave: {
      type: String,
      default: null,
      trim: true,
    },

    ultimoPeriodoConcluido: {
      type: String,
      default: null,
      trim: true,
    },

    ultimaExecucaoEm: {
      type: Date,
      default: null,
    },

    ultimoErro: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'trophy_award_states',
  }
);

TrophyAwardStateSchema.index(
  { temporadaId: 1, periodoTipo: 1 },
  { unique: true, name: 'temporada_periodo_trofeu_unique' }
);

module.exports =
  mongoose.models.TrophyAwardState ||
  mongoose.model('TrophyAwardState', TrophyAwardStateSchema);

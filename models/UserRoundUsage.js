const mongoose = require('mongoose');

const UserRoundUsageSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    temporadaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RankingSeason',
      required: true,
      index: true,
    },

    rodadaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RankingRound',
      required: true,
      index: true,
    },

    numeroRodada: {
      type: Number,
      required: true,
      min: 1,
    },

    planoNoMomento: {
      type: String,
      enum: ['lite', 'premium'],
      required: true,
      default: 'lite',
    },

    limiteOrdens: {
      type: Number,
      default: 15,
      min: 1,
    },

    ordensUtilizadas: {
      type: Number,
      default: 0,
      min: 0,
    },

    primeiraOrdemEm: {
      type: Date,
      default: null,
    },

    ultimaOrdemEm: {
      type: Date,
      default: null,
    },

    limiteAtingidoEm: {
      type: Date,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'user_round_usage',
  }
);

UserRoundUsageSchema.index(
  {
    usuarioId: 1,
    temporadaId: 1,
    rodadaId: 1,
  },
  {
    unique: true,
    name: 'usuario_temporada_rodada_unique',
  }
);

UserRoundUsageSchema.index({
  temporadaId: 1,
  rodadaId: 1,
  planoNoMomento: 1,
});

UserRoundUsageSchema.virtual('ordensRestantes').get(function () {
  if (this.planoNoMomento === 'premium') {
    return null;
  }

  return Math.max(
    0,
    Number(this.limiteOrdens || 0) -
      Number(this.ordensUtilizadas || 0)
  );
});

UserRoundUsageSchema.virtual('limiteAtingido').get(function () {
  if (this.planoNoMomento === 'premium') {
    return false;
  }

  return (
    Number(this.ordensUtilizadas || 0) >=
    Number(this.limiteOrdens || 0)
  );
});

UserRoundUsageSchema.set('toJSON', {
  virtuals: true,
});

UserRoundUsageSchema.set('toObject', {
  virtuals: true,
});

UserRoundUsageSchema.statics.buscarUso = function ({
  usuarioId,
  temporadaId,
  rodadaId,
  session = null,
}) {
  const query = this.findOne({
    usuarioId,
    temporadaId,
    rodadaId,
  });

  if (session) {
    query.session(session);
  }

  return query;
};

UserRoundUsageSchema.statics.buscarOuCriar = async function ({
  usuarioId,
  temporadaId,
  rodadaId,
  numeroRodada,
  planoNoMomento,
  limiteOrdens,
  session = null,
}) {
  const options = {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  };

  if (session) {
    options.session = session;
  }

  return this.findOneAndUpdate(
    {
      usuarioId,
      temporadaId,
      rodadaId,
    },
    {
      $setOnInsert: {
        usuarioId,
        temporadaId,
        rodadaId,
        numeroRodada,
        planoNoMomento,
        limiteOrdens,
        ordensUtilizadas: 0,
        primeiraOrdemEm: null,
        ultimaOrdemEm: null,
        limiteAtingidoEm: null,
      },
    },
    options
  );
};

UserRoundUsageSchema.statics.consumirOrdemLite =
  async function ({
    usuarioId,
    temporadaId,
    rodadaId,
    numeroRodada,
    limiteOrdens,
    session = null,
  }) {
    const agora = new Date();

    const options = {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    };

    if (session) {
      options.session = session;
    }

    const uso = await this.findOneAndUpdate(
      {
        usuarioId,
        temporadaId,
        rodadaId,

        $expr: {
          $lt: [
            {
              $ifNull: [
                '$ordensUtilizadas',
                0,
              ],
            },
            {
              $ifNull: [
                '$limiteOrdens',
                limiteOrdens,
              ],
            },
          ],
        },
      },
      {
        $setOnInsert: {
          usuarioId,
          temporadaId,
          rodadaId,
          numeroRodada,
          planoNoMomento: 'lite',
          limiteOrdens,
          ordensUtilizadas: 0,
          primeiraOrdemEm: agora,
        },

        $set: {
          ultimaOrdemEm: agora,
        },

        $inc: {
          ordensUtilizadas: 1,
        },
      },
      options
    );

    if (!uso) {
      return null;
    }

    if (
      Number(uso.ordensUtilizadas || 0) >=
        Number(uso.limiteOrdens || limiteOrdens) &&
      !uso.limiteAtingidoEm
    ) {
      uso.limiteAtingidoEm = agora;

      await uso.save({
        session: session || undefined,
      });
    }

    return uso;
  };

module.exports =
  mongoose.models.UserRoundUsage ||
  mongoose.model(
    'UserRoundUsage',
    UserRoundUsageSchema
  );
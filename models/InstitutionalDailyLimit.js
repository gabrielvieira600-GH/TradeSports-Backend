const mongoose = require('mongoose');

const InstitutionalDailyLimitSchema = new mongoose.Schema(
  {
    dateKey: { type: String, required: true, index: true },
    clubId: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    quantity: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'institutional_daily_limits' }
);

InstitutionalDailyLimitSchema.index({ dateKey: 1, clubId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.InstitutionalDailyLimit ||
  mongoose.model('InstitutionalDailyLimit', InstitutionalDailyLimitSchema);

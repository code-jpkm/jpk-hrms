const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: String,
  password: { type: String, select: false },
  // v27: sign-in is email (or employee code) + password + picture captcha.
  // GOOGLE stays in the list only so older records still validate.
  authProvider: { type: String, enum: ['PASSWORD', 'GOOGLE'], default: 'PASSWORD' },
  failedLoginCount: { type: Number, default: 0, select: false },
  lockedUntil: { type: Date, select: false },
  role: { type: String, enum: ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE'], default: 'EMPLOYEE' },
  status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },
  forcePasswordChange: { type: Boolean, default: false },
  passwordChangedAt: Date,
  tempPasswordSentAt: Date,
  invitedAt: Date,
  lastLoginAt: Date,
  lastSeenAt: { type: Date, index: true },
  operationPermissions: {
    allowAll: { type: Boolean, default: false },
    modules: [{
      module: { type: String, uppercase: true, trim: true },
      actions: [{ type: String, uppercase: true, trim: true }]
    }]
  }
}, { timestamps: true });

userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  this.passwordChangedAt = new Date();
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

/** True when a password has been set (select('+password') or passwordChangedAt). */
userSchema.methods.hasPassword = function hasPassword() {
  return Boolean(this.password || this.passwordChangedAt);
};

// Never send password hashes or lock counters to a browser.
userSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.password;
    delete ret.failedLoginCount;
    delete ret.lockedUntil;
    ret.hasPassword = Boolean(doc.passwordChangedAt || doc.password);
    return ret;
  }
});

// Keep the signed-in cache (middleware/auth.js) honest: any change to a user
// clears that user, except the once-a-minute "last seen" heartbeat.
const authCache = require('../services/authCache');
const { watchWrites } = require('../services/memoCache');

const presenceOnly = (update) => {
  if (!update || typeof update !== 'object') return false;
  const keys = Object.keys(update).filter((k) => k !== '$setOnInsert');
  const fields = Object.keys(update.$set || {});
  return keys.length === 1 && keys[0] === '$set' && fields.includes('lastSeenAt') && fields.every((k) => k === 'lastSeenAt' || k === 'updatedAt');
};
watchWrites(userSchema, ({ ids, update }) => {
  if (presenceOnly(update)) return;
  if (ids) ids.forEach((id) => authCache.delete(id));
  else authCache.clear();
});

module.exports = mongoose.model('User', userSchema);

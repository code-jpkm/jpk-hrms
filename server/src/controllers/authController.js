const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const env = require('../config/env');
const User = require('../models/User');
const Employee = require('../models/Employee');
const PasswordResetToken = require('../models/PasswordResetToken');
const { createCaptcha, verifyCaptcha } = require('../services/captchaService');
const { assertStrongPassword } = require('../services/loginAccessService');
const { notify } = require('../services/messaging/dispatcher');

// Compared against when no login matches, so a wrong email takes as long as a
// wrong password (no "this email exists" timing hint).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const GENERIC_LOGIN_ERROR = 'Wrong email / employee code or password';

function signToken(user) {
  return jwt.sign(
    { sub: user._id, role: user.role, tenantId: user.tenantId },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}

function publicUser(user) {
  return user.toJSON ? user.toJSON() : { ...user, password: undefined };
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireCaptcha(req) {
  if (!env.login.captcha) return;
  if (!verifyCaptcha(req.body?.captchaToken, req.body?.captchaAnswer)) {
    throw new ApiError(400, 'The letters don’t match the picture. Type the letters from the new picture.', { code: 'CAPTCHA_INVALID' });
  }
}

/** Logins matching an email, or an employee code (e.g. JPK001). */
async function findLogins(identifier) {
  const value = String(identifier || '').trim();
  if (!value || value.length > 160) return [];
  const fields = '+password +failedLoginCount +lockedUntil';
  if (value.includes('@')) return User.find({ email: value.toLowerCase() }).select(fields).limit(5);
  const employees = await Employee.find({ employeeCode: new RegExp(`^${escapeRegex(value)}$`, 'i'), userId: { $exists: true } })
    .select('userId').limit(5).lean();
  if (!employees.length) return [];
  return User.find({ _id: { $in: employees.map((e) => e.userId) } }).select(fields).limit(5);
}

function minutesUntil(date) {
  return Math.max(1, Math.ceil((new Date(date).getTime() - Date.now()) / 60000));
}

exports.captcha = (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ...createCaptcha(), required: env.login.captcha });
};

exports.login = asyncHandler(async (req, res) => {
  const identifier = String(req.body?.email ?? req.body?.identifier ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!identifier || !password) throw new ApiError(400, 'Enter your email (or employee code) and your password');
  requireCaptcha(req);

  const candidates = await findLogins(identifier);
  if (!candidates.length) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new ApiError(401, GENERIC_LOGIN_ERROR, { code: 'BAD_CREDENTIALS' });
  }

  const now = new Date();
  const lockAfter = Math.max(3, env.login.lockAfterFailures);
  let matched = null;
  let locked = null;
  for (const user of candidates) {
    if (user.lockedUntil && user.lockedUntil > now) { locked = locked || user; continue; }
    if (!user.password) { await bcrypt.compare(password, DUMMY_HASH); continue; }
    if (await user.comparePassword(password)) { matched = user; break; }
    user.failedLoginCount = (user.failedLoginCount || 0) + 1;
    if (user.failedLoginCount >= lockAfter) {
      user.lockedUntil = new Date(now.getTime() + env.login.lockMinutes * 60000);
      user.failedLoginCount = 0;
    }
    await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: user.failedLoginCount, ...(user.lockedUntil ? { lockedUntil: user.lockedUntil } : {}) } });
  }

  if (!matched) {
    if (locked) {
      throw new ApiError(429, `Too many wrong passwords. This login is paused for ${minutesUntil(locked.lockedUntil)} more minute(s). You can also use “Forgot password”.`, { code: 'LOCKED' });
    }
    throw new ApiError(401, GENERIC_LOGIN_ERROR, { code: 'BAD_CREDENTIALS' });
  }
  if (matched.status !== 'ACTIVE') throw new ApiError(403, 'Your HRMS access is disabled. Please contact HR.');

  await User.updateOne(
    { _id: matched._id },
    { $set: { lastLoginAt: now, failedLoginCount: 0, authProvider: 'PASSWORD' }, $unset: { lockedUntil: 1 } }
  );
  matched.lastLoginAt = now;
  res.json({ token: signToken(matched), user: publicUser(matched) });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  const user = await User.findById(req.user._id).select('+password');
  if (!user) throw new ApiError(401, 'Please sign in again');
  if (user.password && !(await user.comparePassword(currentPassword))) {
    throw new ApiError(400, 'Your current password is not correct');
  }
  assertStrongPassword(newPassword, user);
  if (user.password && await user.comparePassword(newPassword)) throw new ApiError(400, 'Choose a password different from the current one');
  user.password = newPassword;
  user.forcePasswordChange = false;
  user.authProvider = 'PASSWORD';
  await user.save();
  // Other devices signed in with the old password are signed out (see middleware/auth);
  // this one gets a fresh token.
  res.json({ message: 'Password changed', token: signToken(user), user: publicUser(user) });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const identifier = String(req.body?.email ?? req.body?.identifier ?? '').trim();
  if (!identifier) throw new ApiError(400, 'Enter your email or employee code');
  requireCaptcha(req);
  const reply = {
    message: 'If this login exists, a reset link has been sent to its email and WhatsApp. The link works for '
      + `${env.login.resetLinkMinutes} minutes. No message? Ask HR to send you new login details.`
  };

  const users = (await findLogins(identifier)).filter((u) => u.status === 'ACTIVE');
  for (const user of users.slice(0, 1)) {
    const recent = await PasswordResetToken.exists({ userId: user._id, createdAt: { $gt: new Date(Date.now() - 2 * 60000) } });
    if (recent) break;
    const raw = crypto.randomBytes(32).toString('base64url');
    await PasswordResetToken.create({
      tenantId: user.tenantId,
      userId: user._id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + env.login.resetLinkMinutes * 60000),
      channel: 'BOTH'
    });
    const resetUrl = `${env.appUrl}/reset-password?token=${raw}`;
    const employee = await Employee.findOne({ tenantId: user.tenantId, userId: user._id }).select('_id firstName lastName phone').lean();
    await notify({
      tenantId: user.tenantId,
      event: 'PASSWORD_RESET',
      recipients: [{ employeeId: employee?._id, userId: user._id, email: user.email, phone: user.phone || employee?.phone, name: employee ? `${employee.firstName} ${employee.lastName || ''}`.trim() : user.name }],
      data: { resetUrl, minutes: env.login.resetLinkMinutes },
      link: resetUrl,
      wait: true
    });
  }
  res.json(reply);
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const raw = String(req.body?.token ?? '').trim();
  const newPassword = String(req.body?.password ?? req.body?.newPassword ?? '');
  if (!raw) throw new ApiError(400, 'This reset link is incomplete. Open the link from the message again.');
  const record = await PasswordResetToken.findOne({ tokenHash: hashToken(raw), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
  if (!record) throw new ApiError(400, 'This reset link has expired or was already used. Ask for a new one.', { code: 'RESET_LINK_INVALID' });
  const user = await User.findById(record.userId).select('+password +failedLoginCount +lockedUntil');
  if (!user || user.status !== 'ACTIVE') throw new ApiError(400, 'This login is disabled. Please contact HR.');
  assertStrongPassword(newPassword, user);
  user.password = newPassword;
  user.forcePasswordChange = false;
  user.failedLoginCount = 0;
  user.lockedUntil = undefined;
  user.authProvider = 'PASSWORD';
  await user.save();
  await PasswordResetToken.updateMany({ userId: user._id, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
  res.json({ message: 'Your password is changed. Sign in with the new password.' });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ user: req.user, employee: req.employee });
});

const crypto = require('crypto');
const User = require('../models/User');
const Employee = require('../models/Employee');
const env = require('../config/env');
const ApiError = require('../utils/apiError');
const { notify } = require('./messaging/dispatcher');

/**
 * Passwords for portal logins (v27 replaced Google sign-in).
 *
 * HR gives a person access with "Send login details": the server makes a
 * one-time temporary password, emails / WhatsApps it with the sign-in link and
 * shows it once to HR (for when messaging is not set up). The person must pick
 * their own password right after signing in with it.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const MIN_LENGTH = 8;

function generateTemporaryPassword(length = 10) {
  for (;;) {
    let value = '';
    for (let i = 0; i < length; i += 1) value += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (/[A-Za-z]/.test(value) && /\d/.test(value)) return value;
  }
}

/** Throws a readable 400 when a new password is too weak. */
function assertStrongPassword(password, user) {
  const value = String(password || '');
  if (value.length < MIN_LENGTH) throw new ApiError(400, `Use at least ${MIN_LENGTH} characters for the password`);
  if (value.length > 128) throw new ApiError(400, 'Use at most 128 characters for the password');
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) throw new ApiError(400, 'Use both letters and numbers in the password');
  const email = String(user?.email || '').toLowerCase();
  const local = email.split('@')[0];
  const lower = value.toLowerCase();
  if ((email && lower.includes(email)) || (local.length >= 4 && lower.includes(local))) {
    throw new ApiError(400, 'The password must not contain your email address');
  }
  if (/^(password|passw0rd|qwerty|12345678|abcd1234|jpk12345)/i.test(value)) throw new ApiError(400, 'This password is too easy to guess');
}

/** Gives a login a new one-time password. Signs it out everywhere. */
async function issueTemporaryPassword(userId) {
  const user = await User.findById(userId).select('+password +failedLoginCount +lockedUntil');
  if (!user) throw new ApiError(404, 'Login not found');
  const temporaryPassword = generateTemporaryPassword();
  user.password = temporaryPassword;
  user.forcePasswordChange = true;
  user.tempPasswordSentAt = new Date();
  user.invitedAt = new Date();
  user.authProvider = 'PASSWORD';
  user.failedLoginCount = 0;
  user.lockedUntil = undefined;
  await user.save();
  return { user, temporaryPassword };
}

function loginUrl() {
  return `${env.appUrl}/login`;
}

/** Only what HR needs to see: never the message text (it holds the password). */
function summariseLogs(logs = []) {
  return (logs || []).filter(Boolean).map((log) => ({
    channel: log.channel,
    to: log.to,
    status: log.status,
    error: log.error || undefined
  }));
}

function deliveredSomewhere(logs = []) {
  return logs.some((log) => ['SENT', 'DELIVERED', 'READ', 'PENDING', 'QUEUED', 'SENDING'].includes(log.status));
}

async function sendLoginDetails({ tenantId, employee, user, temporaryPassword }) {
  const name = employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() : user.name;
  const logs = await notify({
    tenantId,
    event: 'ACCESS_INVITE',
    recipients: [{ employeeId: employee?._id, userId: user._id, email: user.email, phone: user.phone || employee?.phone, name: name || user.name }],
    data: { loginUrl: loginUrl(), loginEmail: user.email, employeeCode: employee?.employeeCode || '', temporaryPassword },
    link: loginUrl(),
    wait: true
  });
  return summariseLogs(logs);
}

/** Issue + send in one step. Returns what the HR screen shows. */
async function giveLoginDetails({ tenantId, employee, user }) {
  const issued = await issueTemporaryPassword(user._id);
  const notificationLogs = await sendLoginDetails({ tenantId, employee, user: issued.user, temporaryPassword: issued.temporaryPassword });
  const delivered = deliveredSomewhere(notificationLogs);
  return {
    temporaryPassword: issued.temporaryPassword,
    notificationLogs,
    delivered,
    message: delivered
      ? `Login details sent to ${issued.user.email}. They must choose a new password when they sign in.`
      : 'Login details created, but email / WhatsApp is not set up or failed. Give the temporary password below to the employee yourself.'
  };
}

/**
 * First start after switching from Google sign-in: logins had no passwords.
 * ADMIN_EMAIL + ADMIN_PASSWORD give that one login a password (only while it
 * has none, unless ADMIN_PASSWORD_RESET=true), so the Super Admin can sign in
 * and send everyone else their login details.
 */
async function applyAdminPasswordFromEnv() {
  const email = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email || !password) return null;
  const force = String(process.env.ADMIN_PASSWORD_RESET || '').toLowerCase() === 'true';
  const users = await User.find({ email }).select('+password');
  if (!users.length) {
    console.warn(`[login] ADMIN_EMAIL ${email} is not a login in the database. Check the address.`);
    return null;
  }
  let changed = 0;
  for (const user of users) {
    if (user.password && !force) continue;
    user.password = password;
    user.forcePasswordChange = true;
    user.status = 'ACTIVE';
    user.authProvider = 'PASSWORD';
    user.failedLoginCount = 0;
    user.lockedUntil = undefined;
    await user.save();
    changed += 1;
  }
  if (changed) console.log(`[login] Password set for ${email} from ADMIN_PASSWORD. Sign in, choose a new password, then remove ADMIN_PASSWORD from the server settings.`);
  return changed;
}

/** Active logins with no password yet (everyone who used Google before v27). */
async function loginsWithoutPassword(tenantId) {
  return User.find({
    tenantId,
    status: 'ACTIVE',
    $or: [{ password: { $exists: false } }, { password: null }, { password: '' }]
  }).select('_id email name phone role');
}

/** "Send login details to everyone who has no password yet". */
async function giveLoginDetailsToAll({ tenantId, actor }) {
  const users = await loginsWithoutPassword(tenantId);
  const results = [];
  for (const user of users) {
    if (['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role) && actor?.role !== 'SUPER_ADMIN') continue;
    const employee = await Employee.findOne({ tenantId, userId: user._id, status: { $ne: 'OFFBOARDED' } }).select('_id firstName lastName employeeCode phone');
    if (!employee && user.role !== 'SUPER_ADMIN' && user.role !== 'HR_ADMIN') continue;
    try {
      const outcome = await giveLoginDetails({ tenantId, employee, user });
      results.push({
        name: employee ? `${employee.firstName} ${employee.lastName || ''}`.trim() : user.name,
        employeeCode: employee?.employeeCode || '',
        email: user.email,
        delivered: outcome.delivered,
        // Only returned when no message went out, so HR can hand it over.
        temporaryPassword: outcome.delivered ? undefined : outcome.temporaryPassword
      });
    } catch (error) {
      results.push({ name: user.name, email: user.email, delivered: false, error: error.message });
    }
  }
  return {
    total: results.length,
    delivered: results.filter((r) => r.delivered).length,
    results
  };
}

module.exports = {
  MIN_LENGTH,
  generateTemporaryPassword,
  assertStrongPassword,
  issueTemporaryPassword,
  sendLoginDetails,
  giveLoginDetails,
  giveLoginDetailsToAll,
  loginsWithoutPassword,
  applyAdminPasswordFromEnv,
  summariseLogs,
  loginUrl
};

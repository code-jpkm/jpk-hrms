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

const ADMIN_ROLES = ['SUPER_ADMIN', 'HR_ADMIN'];
const fullName = (e) => `${e?.firstName || ''} ${e?.lastName || ''}`.trim();

/**
 * Who "Send login details to everyone" reaches, by group:
 *  - create:  active employees with an email but no login yet (a login is made)
 *  - send:    logins that never had a password in this HRMS (old Google logins)
 *  - waiting: got a temporary password already but have not used it yet
 *  - ready:   already have a password of their own (changed only when asked)
 *  - noEmail: no email in the profile, so no login can be made
 *  - disabled: the login is turned off
 * The person pressing the button is never included, and other admin logins only
 * when a Super Admin presses it.
 */
async function loginDetailsPlan({ tenantId, actor }) {
  const employees = await Employee.find({ tenantId, status: { $ne: 'OFFBOARDED' } })
    .select('_id firstName lastName employeeCode email phone userId')
    .populate('userId', 'email role status passwordChangedAt forcePasswordChange tempPasswordSentAt lastLoginAt')
    .sort({ employeeCode: 1 })
    .lean();
  const plan = { create: [], send: [], waiting: [], ready: [], noEmail: [], disabled: [], admins: [] };
  const linked = new Set();
  const actorId = String(actor?._id || '');
  for (const e of employees) {
    const user = e.userId && typeof e.userId === 'object' ? e.userId : null;
    const row = { employeeId: String(e._id), name: fullName(e), employeeCode: e.employeeCode || '', email: user?.email || e.email || '' };
    if (user) linked.add(String(user._id));
    if (user && String(user._id) === actorId) continue;
    if (!user) {
      (e.email ? plan.create : plan.noEmail).push(row);
    } else if (user.status !== 'ACTIVE') {
      plan.disabled.push(row);
    } else if (ADMIN_ROLES.includes(user.role) && actor?.role !== 'SUPER_ADMIN') {
      plan.admins.push(row);
    } else if (!user.passwordChangedAt) {
      plan.send.push({ ...row, userId: String(user._id) });
    } else if (user.forcePasswordChange) {
      plan.waiting.push({ ...row, userId: String(user._id), sentAt: user.tempPasswordSentAt || null });
    } else {
      plan.ready.push({ ...row, userId: String(user._id), lastLoginAt: user.lastLoginAt || null });
    }
  }
  // Admin logins without an employee profile (only a Super Admin sends to these).
  if (actor?.role === 'SUPER_ADMIN') {
    const loose = await User.find({
      tenantId,
      status: 'ACTIVE',
      role: { $in: ADMIN_ROLES },
      _id: { $nin: [...linked, actorId].filter(Boolean) },
      $or: [{ passwordChangedAt: { $exists: false } }, { passwordChangedAt: null }]
    }).select('_id email name').lean();
    for (const u of loose) plan.send.push({ employeeId: '', userId: String(u._id), name: u.name || u.email, employeeCode: '', email: u.email });
  }
  return plan;
}

function planCounts(plan) {
  return {
    create: plan.create.length,
    send: plan.send.length,
    waiting: plan.waiting.length,
    noEmail: plan.noEmail.length,
    disabled: plan.disabled.length,
    admins: plan.admins.length,
    ready: plan.ready.length,
    // What the button sends to without extra choices.
    toSend: plan.create.length + plan.send.length
  };
}

/**
 * "Send login details to everyone who cannot sign in yet": makes logins for
 * employees who have none, gives each a temporary password and sends it by
 * email / WhatsApp. `includeWaiting` also sends a fresh one to people who got
 * login details before but never used them; `includeReady` also replaces the
 * password of people who already have one (for example from an old system).
 */
async function giveLoginDetailsToAll({ tenantId, actor, includeWaiting = false, includeReady = false }) {
  const guard = require('./accountGuardService');
  const plan = await loginDetailsPlan({ tenantId, actor });
  const targets = [...plan.create, ...plan.send, ...(includeWaiting ? plan.waiting : []), ...(includeReady ? plan.ready : [])];
  const results = [];
  for (const target of targets) {
    try {
      let employee = null;
      let user = null;
      if (target.employeeId) {
        employee = await Employee.findOne({ _id: target.employeeId, tenantId });
        if (!employee) continue;
        user = await guard.resolveLoginForEmployee({
          actor, tenantId, employee, email: target.userId ? target.email : employee.email, phone: employee.phone, name: fullName(employee)
        });
        if (!user) throw new ApiError(400, 'Add the employee\'s email first: it is their login name');
        // Link without re-validating the whole (possibly old) employee record.
        if (String(employee.userId || '') !== String(user._id)) await Employee.updateOne({ _id: employee._id, tenantId }, { $set: { userId: user._id } });
      } else {
        user = await User.findOne({ _id: target.userId, tenantId });
        if (!user) continue;
      }
      guard.assertCanManageAccount(actor, user);
      const outcome = await giveLoginDetails({ tenantId, employee, user });
      results.push({
        name: target.name,
        employeeCode: target.employeeCode,
        email: user.email,
        delivered: outcome.delivered,
        createdLogin: !target.userId && Boolean(target.employeeId),
        // Only returned when no message went out, so HR can hand it over.
        temporaryPassword: outcome.delivered ? undefined : outcome.temporaryPassword
      });
    } catch (error) {
      results.push({ name: target.name, employeeCode: target.employeeCode, email: target.email, delivered: false, error: error.message });
    }
  }
  return {
    total: results.length,
    delivered: results.filter((r) => r.delivered).length,
    failed: results.filter((r) => r.error).length,
    results,
    skipped: { noEmail: plan.noEmail, disabled: plan.disabled }
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
  loginDetailsPlan,
  planCounts,
  loginsWithoutPassword,
  applyAdminPasswordFromEnv,
  summariseLogs,
  loginUrl
};

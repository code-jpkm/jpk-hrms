const jwt = require('jsonwebtoken');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const { jwtSecret } = require('../config/env');
const User = require('../models/User');
const Employee = require('../models/Employee');
const signedIn = require('../services/authCache');

/**
 * The user and their employee record, from the short cache when possible
 * (services/authCache.js). On a miss both are read at the same time: the
 * token already says which company the user belongs to.
 */
async function whoIs(payload) {
  const key = String(payload.sub);
  let entry = signedIn.get(key);
  if (!entry) {
    let [user, employee] = await Promise.all([
      User.findById(payload.sub).lean(),
      payload.tenantId ? Employee.findOne({ userId: payload.sub, tenantId: payload.tenantId }).lean() : null
    ]);
    if (user && String(user.tenantId) !== String(payload.tenantId || '')) {
      employee = await Employee.findOne({ userId: user._id, tenantId: user.tenantId }).lean();
    }
    entry = { user: user ? JSON.stringify(user) : null, employee: employee ? JSON.stringify(employee) : null };
    if (user) signedIn.set(key, entry);
  }
  return {
    user: entry.user ? User.hydrate(JSON.parse(entry.user)) : null,
    employee: entry.employee ? Employee.hydrate(JSON.parse(entry.employee)) : null
  };
}

const auth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, 'Missing authorization token');
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch (error) {
    throw new ApiError(401, 'Invalid or expired token');
  }
  const { user, employee } = await whoIs(payload);
  if (!user || user.status !== 'ACTIVE') throw new ApiError(401, 'User not active');
  // A password change (or new login details from HR) signs out every older session.
  if (user.passwordChangedAt && payload.iat && payload.iat * 1000 < new Date(user.passwordChangedAt).getTime() - 2000) {
    throw new ApiError(401, 'Your password was changed. Please sign in again.', { code: 'PASSWORD_CHANGED' });
  }
  // Signed in with a temporary password: only the sign-in endpoints work until
  // the person chooses their own password.
  if (user.forcePasswordChange && !String(req.originalUrl || '').startsWith('/api/auth/')) {
    throw new ApiError(403, 'Choose your own password first.', { code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  // Lightweight presence heartbeat. Any normal authenticated activity keeps the
  // employee directory's Online / Last active indicator fresh without a noisy
  // write on every request.
  const now = new Date();
  if (!user.lastSeenAt || now.getTime() - new Date(user.lastSeenAt).getTime() >= 60_000) {
    user.lastSeenAt = now;
    // timestamps: false — being seen online is not an edit of the user.
    User.updateOne({ _id: user._id }, { $set: { lastSeenAt: now } }, { timestamps: false }).catch(() => {});
    signedIn.update(user._id, (entry) => {
      if (!entry?.user) return entry;
      const u = JSON.parse(entry.user);
      u.lastSeenAt = now;
      return { ...entry, user: JSON.stringify(u) };
    });
  }

  req.user = user;
  req.employee = employee;
  req.tenantId = user.tenantId;
  next();
});


function hasAbility(user, moduleName, action) {
  if (!user) return false;
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role)) return true;
  const normalizedModule = String(moduleName || '').toUpperCase();
  const normalizedAction = String(action || '').toUpperCase();
  const permissions = user.operationPermissions || {};
  if (permissions.allowAll) return true;
  const modules = permissions.modules || [];
  return modules.some((entry) => {
    if (String(entry.module || '').toUpperCase() !== normalizedModule) return false;
    const actions = (entry.actions || []).map((a) => String(a).toUpperCase());
    return actions.includes('ALL') || actions.includes('MANAGE') || actions.includes(normalizedAction);
  });
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    if (hasAbility(req.user, 'SYSTEM', 'MANAGE')) return next();
    return next(new ApiError(403, 'You do not have permission for this action'));
  };
}

function requireAbility(moduleName, action, ...roleFallbacks) {
  return (req, res, next) => {
    if (req.user.role === 'SUPER_ADMIN') return next();
    if (roleFallbacks.includes(req.user.role)) return next();
    if (hasAbility(req.user, moduleName, action)) return next();
    return next(new ApiError(403, `Missing permission: ${String(moduleName).toUpperCase()}:${String(action).toUpperCase()}`));
  };
}

module.exports = { auth, requireRoles, requireAbility, hasAbility };


const InAppNotification = require('../models/InAppNotification');
const User = require('../models/User');
const Employee = require('../models/Employee');

async function notifyUser({ tenantId, userId, actorUserId, type = 'GENERAL', title, body = '', link = '', entityType, entityId, priority = 'NORMAL', data }) {
  if (!tenantId || !userId || !title) return null;
  return InAppNotification.create({ tenantId, recipientUserId: userId, actorUserId, type, title, body, link, entityType, entityId: entityId ? String(entityId) : undefined, priority, data });
}

async function notifyEmployee({ tenantId, employeeId, ...payload }) {
  if (!employeeId) return null;
  const employee = await Employee.findOne({ tenantId, _id: employeeId }).select('userId');
  if (!employee?.userId) return null;
  return notifyUser({ tenantId, userId: employee.userId, ...payload });
}

async function notifyRoles({ tenantId, roles = [], ...payload }) {
  const users = await User.find({ tenantId, status: 'ACTIVE', role: { $in: roles } }).select('_id');
  const results = [];
  for (const user of users) results.push(await notifyUser({ tenantId, userId: user._id, ...payload }));
  return results.filter(Boolean);
}

module.exports = { notifyUser, notifyEmployee, notifyRoles };

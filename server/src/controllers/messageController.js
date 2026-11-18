/**
 * Message Center: HR sends a custom message (email / WhatsApp / in-app) to
 * everyone, a workplace, a department or chosen people; any employee can send
 * a birthday or anniversary wish to a colleague from the home page.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Employee = require('../models/Employee');
const NotificationLog = require('../models/NotificationLog');
const { hasAbility } = require('../middleware/auth');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { notify } = require('../services/messaging/dispatcher');
const { getConfig } = require('../services/integrationConfigService');
const { composeMessage } = require('../services/ai/aiFeatures');

const MAX_BROADCAST = 2000;

function canBroadcast(user) {
  return ['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role) || hasAbility(user, 'NOTICES', 'MANAGE') || hasAbility(user, 'MESSAGES', 'SEND');
}

async function audienceEmployees(req, audience = {}) {
  const scope = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' });
  const q = { tenantId: req.tenantId, _id: { $in: scope }, status: { $ne: 'OFFBOARDED' } };
  const type = String(audience.type || 'ALL').toUpperCase();
  if (type === 'OFFICE' || type === 'FACTORY') q.workLocation = { $in: [type, 'BOTH'] };
  if (type === 'DEPARTMENT') {
    const depts = (Array.isArray(audience.departments) ? audience.departments : [audience.department]).filter(Boolean).map(String);
    if (!depts.length) throw new ApiError(400, 'Choose at least one department');
    q.department = { $in: depts };
  }
  if (type === 'SELECTED') {
    const ids = (audience.employeeIds || []).map(String).filter((id) => /^[a-f0-9]{24}$/i.test(id));
    if (!ids.length) throw new ApiError(400, 'Choose at least one person');
    q._id = { $in: ids.filter((id) => scope.map(String).includes(id)) };
  }
  return Employee.find(q).select('_id firstName lastName userId email phone').lean();
}

exports.preview = asyncHandler(async (req, res) => {
  if (!canBroadcast(req.user)) throw new ApiError(403, 'Only HR can send company messages');
  const people = await audienceEmployees(req, req.body?.audience);
  res.json({
    count: people.length,
    withEmail: people.filter((p) => p.email || p.userId).length,
    withPhone: people.filter((p) => p.phone).length,
    sample: people.slice(0, 6).map((p) => `${p.firstName} ${p.lastName || ''}`.trim())
  });
});

exports.broadcast = asyncHandler(async (req, res) => {
  if (!canBroadcast(req.user)) throw new ApiError(403, 'Only HR can send company messages');
  const subject = String(req.body?.subject || '').trim().slice(0, 160);
  const message = String(req.body?.message || '').trim().slice(0, 4000);
  if (!message) throw new ApiError(400, 'Write the message first');
  const channels = { email: Boolean(req.body?.channels?.email), whatsapp: Boolean(req.body?.channels?.whatsapp), inApp: req.body?.channels?.inApp !== false };
  if (!channels.email && !channels.whatsapp && !channels.inApp) throw new ApiError(400, 'Choose at least one channel');
  const people = await audienceEmployees(req, req.body?.audience);
  if (!people.length) throw new ApiError(400, 'No one matches this audience');
  if (people.length > MAX_BROADCAST) throw new ApiError(400, `A single message can reach at most ${MAX_BROADCAST} people`);
  const batchId = `B${Date.now().toString(36)}`;
  const logs = await notify({
    tenantId: req.tenantId,
    event: 'CUSTOM',
    recipients: people.map((p) => ({ employee: p, employeeId: p._id })),
    data: { subject, message },
    path: '/notices',
    channels,
    entityId: batchId,
    actorUserId: req.user._id,
    inApp: channels.inApp ? { type: 'MESSAGE', title: subject || 'Message from HR', body: message.slice(0, 280), link: '/notices' } : null
  });
  res.json({
    message: `Message queued for ${people.length} ${people.length === 1 ? 'person' : 'people'}`,
    batchId,
    recipients: people.length,
    queued: logs.filter((l) => l?.status === 'QUEUED').length,
    skipped: logs.filter((l) => l?.status === 'SKIPPED').length
  });
});

exports.wish = asyncHandler(async (req, res) => {
  const kind = String(req.body?.kind || 'BIRTHDAY').toUpperCase();
  if (!['BIRTHDAY', 'ANNIVERSARY'].includes(kind)) throw new ApiError(400, 'Wish must be for a birthday or a work anniversary');
  const target = await Employee.findOne({ _id: req.body?.employeeId, tenantId: req.tenantId, status: { $ne: 'OFFBOARDED' } }).select('firstName lastName userId email phone dateOfJoining').lean();
  if (!target) throw new ApiError(404, 'Colleague not found');
  if (req.employee && String(req.employee._id) === String(target._id)) throw new ApiError(400, 'You cannot send a wish to yourself');

  // A person can send each colleague one wish per day.
  const today = new Date().toISOString().slice(0, 10);
  const dedupe = `WISH:${kind}:${target._id}:${req.user._id}:${today}`;
  const already = await NotificationLog.exists({ tenantId: req.tenantId, dedupeKey: { $regex: `^${kind}_WISH:${dedupe}` } });
  if (already) throw new ApiError(409, `You have already wished ${target.firstName} today`);

  let message = String(req.body?.message || '').trim().slice(0, 600);
  if (!message) message = (await composeMessage({ tenantId: req.tenantId, userId: req.user._id, purpose: kind, employeeId: target._id, channel: 'WHATSAPP', fromName: req.user.name })).text;
  const config = await getConfig(req.tenantId);
  const wantWhatsapp = Boolean(req.body?.whatsapp) && config.whatsapp.enabled && config.whatsapp.configured;
  const years = target.dateOfJoining ? Math.max(1, new Date().getFullYear() - new Date(target.dateOfJoining).getFullYear()) : 1;
  const event = kind === 'BIRTHDAY' ? 'BIRTHDAY_WISH' : 'ANNIVERSARY_WISH';
  const logs = await notify({
    tenantId: req.tenantId,
    event,
    recipients: [{ employee: target, employeeId: target._id }],
    data: { message, from: req.user.name, years },
    channels: { email: req.body?.email !== false, whatsapp: wantWhatsapp, inApp: true },
    entityId: dedupe,
    actorUserId: req.user._id,
    inApp: { type: event, title: `${req.user.name} sent you ${kind === 'BIRTHDAY' ? 'birthday' : 'anniversary'} wishes`, body: message, priority: 'NORMAL' }
  });
  res.json({ message: `Your wishes are on their way to ${target.firstName}`, text: message, channels: logs.map((l) => ({ channel: l?.channel, status: l?.status })) });
});

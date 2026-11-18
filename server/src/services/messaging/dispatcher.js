/**
 * notify() — the one call controllers make when something happens that
 * people should hear about. It reads the tenant's notification rules
 * (which channels are on for this event), renders the branded email and the
 * WhatsApp text/template for each recipient, queues them in the outbox, and
 * creates the in-app notification.
 *
 *   await notify({
 *     tenantId, event: 'LEAVE_DECIDED',
 *     recipients: [{ employeeId }],             // or { userId } / { email, phone, name }
 *     data: { leaveType, fromDate, toDate, days, status, remarks },
 *     path: '/leave',                           // deep link inside the HRMS
 *     entityId: request._id,                    // makes the send idempotent
 *     inApp: { type: 'LEAVE_APPROVED', title, body, priority }
 *   });
 *
 * It never throws for delivery problems — those are recorded on the log and
 * shown in Integrations → Delivery log — so a missing phone number can never
 * break an approval.
 */
const Employee = require('../../models/Employee');
const User = require('../../models/User');
const Tenant = require('../../models/Tenant');
const env = require('../../config/env');
const { getConfig } = require('../integrationConfigService');
const { EVENTS } = require('./events');
const { renderEmail, renderText } = require('./emailLayout');
const { normalizeWhatsappNumber } = require('./phone');
const { enqueue, sendNow } = require('./outbox');
const { notifyUser } = require('../inAppNotificationService');
const InAppNotification = require('../../models/InAppNotification');

const tenantCache = new Map();

async function companyName(tenantId) {
  const key = String(tenantId);
  const hit = tenantCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.value;
  const tenant = await Tenant.findById(tenantId).select('name').lean();
  const value = tenant?.name || 'JPK HRMS';
  tenantCache.set(key, { at: Date.now(), value });
  return value;
}

function clientUrl() {
  return String(env.clientUrl || '').replace(/\/$/, '');
}

function absolute(pathOrUrl) {
  if (!pathOrUrl) return clientUrl();
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${clientUrl()}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function shortName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

/** Fill in name / email / phone / userId for each recipient from the HR records. */
async function resolveRecipients(tenantId, recipients = []) {
  const out = [];
  for (const r of recipients) {
    if (!r) continue;
    let employee = r.employee || null;
    let user = r.user || null;
    if (!employee && r.employeeId) employee = await Employee.findOne({ _id: r.employeeId, tenantId }).select('firstName lastName email phone userId employeeCode').lean();
    if (!user && (r.userId || employee?.userId)) user = await User.findOne({ _id: r.userId || employee.userId, tenantId }).select('name email phone status').lean();
    if (!employee && user) employee = await Employee.findOne({ tenantId, userId: user._id }).select('firstName lastName email phone userId employeeCode').lean();
    const name = r.name || (employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() : '') || user?.name || '';
    out.push({
      name,
      email: r.email || user?.email || employee?.email || '',
      phone: r.phone || employee?.phone || user?.phone || '',
      employeeId: employee?._id || r.employeeId,
      userId: user?._id || employee?.userId || r.userId,
      key: String(employee?._id || user?._id || r.email || r.phone || name)
    });
  }
  // One person mapped twice (e.g. manager who is also HR) gets one message.
  const seen = new Set();
  return out.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));
}

async function recipientsForRoles(tenantId, roles = ['SUPER_ADMIN', 'HR_ADMIN']) {
  const users = await User.find({ tenantId, status: 'ACTIVE', role: { $in: roles } }).select('_id name email phone').lean();
  return users.map((u) => ({ user: u, userId: u._id }));
}

function templateParams(def, vars) {
  return (def.template?.params || []).map((p) => {
    const v = vars[p];
    return v === undefined || v === null || v === '' ? '-' : String(v);
  });
}

async function notify({
  tenantId,
  event = 'CUSTOM',
  recipients = [],
  data = {},
  path,
  link,
  attachments = [],
  entityId,
  actorUserId,
  inApp = null,
  channels = null,
  wait = false
}) {
  const results = [];
  if (!tenantId) return results;
  const def = EVENTS[event] || EVENTS.CUSTOM;
  try {
    const [config, company] = await Promise.all([getConfig(tenantId), companyName(tenantId)]);
    const rules = { ...(config.events[event] || def.defaults), ...(channels || {}) };
    const people = await resolveRecipients(tenantId, recipients);
    const deepLink = absolute(link || path || def.build({ ...data, recipientName: '', company, link: '' }).cta?.path);

    for (const person of people) {
      const vars = { ...data, recipientName: shortName(person.name), recipientFullName: person.name, company, link: deepLink };
      const content = def.build(vars);
      Object.assign(vars, content.vars || {});
      const cta = content.cta ? { label: content.cta.label, url: content.cta.url || absolute(content.cta.path) } : null;
      const base = {
        tenantId,
        event,
        recipientName: person.name,
        recipientEmployeeId: person.employeeId,
        recipientUserId: person.userId,
        createdBy: actorUserId,
        meta: { entityId: entityId ? String(entityId) : undefined, ...(def.sensitive ? { sensitive: true } : {}) }
      };

      if (rules.email) {
        const html = renderEmail({ company, heading: content.heading, intro: content.intro, rows: content.rows, cta, tone: content.tone, preheader: content.intro });
        const text = renderText({ heading: content.heading, intro: content.intro, rows: content.rows, cta });
        const log = await enqueue({
          ...base,
          channel: 'EMAIL',
          to: person.email,
          subject: content.subject,
          body: text,
          html,
          attachments,
          ...(person.email ? {} : { status: 'SKIPPED', error: 'No email address on the employee or user record' }),
          dedupeKey: entityId ? `${event}:${entityId}:EMAIL:${person.key}` : undefined
        });
        results.push(log);
      }

      if (rules.whatsapp) {
        const to = normalizeWhatsappNumber(person.phone, config.whatsapp.defaultCountryCode);
        const configuredTemplate = config.whatsapp.templates?.[event];
        const template = configuredTemplate?.name
          ? { name: configuredTemplate.name, language: configuredTemplate.language || config.whatsapp.meta.templateLanguage || 'en', params: templateParams(def, vars) }
          : undefined;
        const log = await enqueue({
          ...base,
          channel: 'WHATSAPP',
          to,
          body: content.whatsapp,
          template,
          attachments: attachments.filter((a) => a.url).map((a) => ({ filename: a.filename, url: a.url, contentType: a.contentType })),
          ...(to ? {} : { status: 'SKIPPED', error: person.phone ? `"${person.phone}" is not a valid mobile number` : 'No mobile number on the employee or user record' }),
          dedupeKey: entityId ? `${event}:${entityId}:WHATSAPP:${person.key}` : undefined
        });
        results.push(log);
      }

      if (inApp && rules.inApp !== false && person.userId) {
        try {
          const type = inApp.type || event;
          // Same idempotency as email/WhatsApp: a re-run job must not repeat the bell notification.
          const duplicate = entityId ? await InAppNotification.exists({ tenantId, recipientUserId: person.userId, type, entityId: String(entityId) }) : null;
          if (!duplicate) await notifyUser({
            tenantId,
            userId: person.userId,
            actorUserId,
            type,
            title: inApp.title || content.heading,
            body: inApp.body ?? content.intro,
            link: inApp.link || path || content.cta?.path || '',
            entityType: inApp.entityType,
            entityId: entityId ? String(entityId) : undefined,
            priority: inApp.priority || 'NORMAL'
          });
        } catch (error) {
          console.error('[notify] in-app failed:', error.message);
        }
      }
    }

    if (wait) {
      const settled = [];
      for (const log of results) settled.push(log && log.status === 'QUEUED' ? await sendNow(log._id) : log);
      return settled;
    }
  } catch (error) {
    console.error(`[notify] ${event} failed:`, error.message);
  }
  return results;
}

/** Fire-and-forget wrapper for request handlers: never delays or fails the response. */
function notifyLater(args) {
  setImmediate(() => {
    notify(args).catch((error) => console.error('[notify] background failure:', error.message));
  });
}

module.exports = { notify, notifyLater, recipientsForRoles, resolveRecipients, absolute };

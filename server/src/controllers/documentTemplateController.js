const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const DocumentTemplate = require('../models/DocumentTemplate');
const Employee = require('../models/Employee');
const SalarySlip = require('../models/SalarySlip');
const Tenant = require('../models/Tenant');
const RuleAudit = require('../models/RuleAudit');
const {
  buildContext, renderTemplateToStream, renderTemplateToBuffer, getActiveTemplate, TOKEN_CATALOGUE
} = require('../services/templateRenderService');
const DocumentAsset = require('../models/DocumentAsset');
const { notify } = require('../services/messaging/dispatcher');
const { starterTemplate, TEMPLATE_TYPES } = require('../services/templatePresets');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { hasAbility } = require('../middleware/auth');

const ADMIN_ROLES = ['SUPER_ADMIN', 'HR_ADMIN'];
// What an employee may issue for themselves without HR. Letters (confirmation,
// increment, relieving, NOC...) carry the company signature and stay with HR.
const SELF_SERVICE_TYPES = ['PAYSLIP'];
// Types whose preset text prints salary figures.
const SALARY_TYPES = ['PAYSLIP', 'SALARY_CERTIFICATE', 'OFFER_LETTER', 'APPOINTMENT_LETTER', 'INCREMENT_LETTER'];
const canDesign = (user) => hasAbility(user, 'DOCUMENTS', 'MANAGE');
const isPayrollAdmin = (user) => ADMIN_ROLES.includes(user?.role) || hasAbility(user, 'PAYROLL', 'RUN');

/** Body fields a designer may set; activation goes through /:id/activate only. */
function templateBody(body = {}) {
  const { _id, tenantId, active, version, createdBy, updatedBy, createdAt, updatedAt, __v, ...rest } = body || {};
  return rest;
}

exports.types = asyncHandler(async (req, res) => {
  res.json({ types: TEMPLATE_TYPES, tokens: TOKEN_CATALOGUE, blockKinds: DocumentTemplate.BLOCK_KINDS });
});

exports.list = asyncHandler(async (req, res) => {
  const q = { tenantId: req.tenantId };
  if (typeof req.query.type === 'string' && req.query.type) q.type = req.query.type;
  if (!canDesign(req.user)) {
    // Non-designers only learn which live formats exist; layouts and the
    // signature / logo images inside them stay with the designers.
    const templates = await DocumentTemplate.find({ ...q, active: true }).select('name type description active updatedAt').sort('type');
    return res.json({ templates, summaryOnly: true });
  }
  const templates = await DocumentTemplate.find(q).sort('type -active -updatedAt');
  res.json({ templates });
});

exports.get = asyncHandler(async (req, res) => {
  if (!canDesign(req.user)) throw new ApiError(403, 'Missing permission: DOCUMENTS:MANAGE');
  const template = await DocumentTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!template) throw new ApiError(404, 'Template not found');
  res.json({ template });
});

exports.create = asyncHandler(async (req, res) => {
  const type = req.body.type;
  if (!type) throw new ApiError(400, 'Template type is required');
  const tenant = await Tenant.findById(req.tenantId);

  // A blank canvas is hostile. Every new template starts from a sensible,
  // fully-laid-out preset for its type that the user then drags around.
  // blank:true means the user chose "start from scratch" and wants an empty page.
  const wantsBlank = req.body.blank === true;
  const preset = (req.body.blocks?.length || wantsBlank) ? null : starterTemplate(type, tenant);
  const template = await DocumentTemplate.create({
    ...(preset || {}),
    ...templateBody(req.body),
    active: false,
    blocks: req.body.blocks?.length ? req.body.blocks : (wantsBlank ? [] : preset?.blocks || []),
    tenantId: req.tenantId,
    name: req.body.name || preset?.name || 'Blank document',
    type,
    createdBy: req.user._id,
    updatedBy: req.user._id
  });
  res.status(201).json({ template });
});

exports.update = asyncHandler(async (req, res) => {
  const before = await DocumentTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId }).lean();
  if (!before) throw new ApiError(404, 'Template not found');
  const changes = templateBody(req.body);
  if (before.active && changes.type && changes.type !== before.type) {
    throw new ApiError(400, 'This is the live format for its type. Activate another template before changing its type.');
  }
  const template = await DocumentTemplate.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId },
    { ...changes, tenantId: req.tenantId, updatedBy: req.user._id, version: Number(before.version || 1) + 1 },
    { new: true, runValidators: true }
  );
  await RuleAudit.create({
    tenantId: req.tenantId, module: 'DOCUMENT_TEMPLATE', action: 'UPDATE_TEMPLATE',
    targetId: String(template._id), before, after: template.toObject(),
    reason: req.body.changeReason || `Template "${template.name}" edited`, changedBy: req.user._id
  });
  res.json({ template });
});

exports.duplicate = asyncHandler(async (req, res) => {
  const source = await DocumentTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!source) throw new ApiError(404, 'Template not found');
  const copy = source.toObject();
  delete copy._id; delete copy.createdAt; delete copy.updatedAt;
  const template = await DocumentTemplate.create({
    ...copy, name: `${source.name} (copy)`, active: false, version: 1,
    createdBy: req.user._id, updatedBy: req.user._id
  });
  res.status(201).json({ template });
});

/** Activating one template of a type deactivates the rest, atomically per type. */
exports.activate = asyncHandler(async (req, res) => {
  const template = await DocumentTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!template) throw new ApiError(404, 'Template not found');
  await DocumentTemplate.updateMany({ tenantId: req.tenantId, type: template.type }, { active: false });
  template.active = true;
  template.updatedBy = req.user._id;
  await template.save();
  await RuleAudit.create({
    tenantId: req.tenantId, module: 'DOCUMENT_TEMPLATE', action: 'ACTIVATE_TEMPLATE',
    targetId: String(template._id), after: { name: template.name, type: template.type },
    reason: `"${template.name}" set as the live ${template.type} format`, changedBy: req.user._id
  });
  res.json({ template, message: `"${template.name}" is now the live ${template.type.replace(/_/g, ' ').toLowerCase()} format` });
});

exports.remove = asyncHandler(async (req, res) => {
  const template = await DocumentTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!template) throw new ApiError(404, 'Template not found');
  if (template.active) throw new ApiError(400, 'This is the live format for its type. Activate another template first, then delete this one.');
  await RuleAudit.create({
    tenantId: req.tenantId, module: 'DOCUMENT_TEMPLATE', action: 'DELETE_TEMPLATE',
    targetId: String(template._id), before: template.toObject(),
    reason: req.body?.reason || 'Template deleted', changedBy: req.user._id
  });
  await template.deleteOne();
  res.json({ deleted: true });
});

async function resolveRenderContext({ tenantId, templateType, employeeId, month, finalizedOnly = false }) {
  const tenant = await Tenant.findById(tenantId);
  let employee = null;
  let slip = null;

  if (employeeId) {
    employee = await Employee.findOne({ _id: employeeId, tenantId });
  } else {
    employee = await Employee.findOne({ tenantId, status: { $ne: 'OFFBOARDED' } }).sort('employeeCode');
  }

  if (templateType === 'PAYSLIP' && employee) {
    const q = { tenantId, employeeId: employee._id };
    if (month) q.month = String(month);
    const slips = await SalarySlip.find(q).sort('-month').limit(month ? 1 : 24).populate('payrollRunId', 'status');
    // Employees must never receive a slip from a payroll run that is still a draft.
    slip = (finalizedOnly ? slips.find((s) => s.payrollRunId?.status === 'FINALIZED') : slips[0]) || null;
  }

  return { tenant, employee, slip, context: buildContext({ tenant, employee, slip }) };
}

/**
 * Live preview. Renders the posted (unsaved) block layout against real data so
 * the designer shows exactly what will be issued, not an approximation.
 */
exports.preview = asyncHandler(async (req, res) => {
  const template = req.body.template
    || (req.params.id ? await DocumentTemplate.findOne({ _id: req.params.id, tenantId: req.tenantId }) : null);
  if (!template) throw new ApiError(400, 'Send a template layout in the body, or call /:id/preview for a saved one');
  if (!Array.isArray(template.blocks) || !template.blocks.length) throw new ApiError(400, 'This template has no blocks yet. Add at least one block before previewing.');
  const { slip, context } = await resolveRenderContext({
    tenantId: req.tenantId,
    templateType: template.type,
    employeeId: req.body.employeeId || req.query.employeeId,
    month: req.body.month || req.query.month
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="template-preview.pdf"');
  await renderTemplateToStream({ template, context, slip, stream: res });
});

/** Issue a real document for a real employee using the live template of that type. */
/** Permission + data checks shared by "download" and "send to employee". */
async function prepareIssue(req) {
  const { type, employeeId, month } = req.body || {};
  if (!type || !employeeId) throw new ApiError(400, 'type and employeeId are required');
  const isAdmin = ADMIN_ROLES.includes(req.user.role);
  const isSelf = String(req.employee?._id || '') === String(employeeId);

  // v26: any user could issue every letter type for themselves, and the scope
  // check used a non-existent resource ('EMPLOYEES').
  if (!isAdmin) {
    const canIssue = hasAbility(req.user, 'DOCUMENTS', 'CREATE');
    if (isSelf && !SELF_SERVICE_TYPES.includes(type) && !canIssue) throw new ApiError(403, 'Ask HR to issue this document');
    if (!isSelf) {
      if (!canIssue) throw new ApiError(403, 'Missing permission: DOCUMENTS:CREATE');
      const profileScope = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' });
      if (!profileScope.includes(String(employeeId))) throw new ApiError(403, 'This employee is outside your scope');
      if (SALARY_TYPES.includes(type)) {
        const salaryScope = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
        if (!salaryScope.includes(String(employeeId))) throw new ApiError(403, "This employee's salary is outside your scope");
      }
    }
  }

  const template = await getActiveTemplate({ tenantId: req.tenantId, type });
  if (!template) throw new ApiError(400, `No active ${type} template. Design one and mark it live first.`);
  const { employee, slip, context } = await resolveRenderContext({ tenantId: req.tenantId, templateType: type, employeeId, month, finalizedOnly: !isPayrollAdmin(req.user) });
  if (!employee) throw new ApiError(404, 'Employee not found');
  if (type === 'PAYSLIP' && !slip) throw new ApiError(404, month ? `No released payslip for ${month}` : 'No released payslip yet');

  const safeName = `${type.toLowerCase()}-${employee.employeeCode || employee._id}${slip?.month ? `-${slip.month}` : ''}`.replace(/[^a-z0-9-]/gi, '');
  return { type, template, employee, slip, context, safeName, isSelf };
}

exports.issue = asyncHandler(async (req, res) => {
  const { template, slip, context, safeName } = await prepareIssue(req);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
  await renderTemplateToStream({ template, context, slip, stream: res });
});

// Letter types that already have a slot in the employee's document list.
const DOCUMENT_ASSET_TYPES = { OFFER_LETTER: 'OFFER_LETTER', JOINING_LETTER: 'JOINING_LETTER', EXPERIENCE_LETTER: 'EXPERIENCE_LETTER' };

/**
 * Issue a letter to the employee: render the PDF, file it under their
 * documents, and email it (WhatsApp gets a link) through the outbox.
 */
exports.sendIssued = asyncHandler(async (req, res) => {
  const { type, template, employee, slip, context, safeName, isSelf } = await prepareIssue(req);
  if (isSelf && !ADMIN_ROLES.includes(req.user.role)) throw new ApiError(403, 'Download the document instead; HR sends letters to employees');
  const channels = { email: req.body?.channels?.email !== false, whatsapp: Boolean(req.body?.channels?.whatsapp), inApp: true };
  const pdf = await renderTemplateToBuffer({ template, context, slip });
  const label = (TEMPLATE_TYPES.find((t) => t.value === type)?.label || template.name || 'Document') + (slip?.month ? ` · ${slip.month}` : '');
  const doc = await DocumentAsset.create({
    tenantId: req.tenantId,
    ownerType: 'EMPLOYEE',
    ownerId: employee._id,
    employeeId: employee._id,
    type: DOCUMENT_ASSET_TYPES[type] || 'OTHER',
    label,
    fileName: `${safeName}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: pdf.length,
    dataUrl: `data:application/pdf;base64,${pdf.toString('base64')}`,
    notes: String(req.body?.note || '').slice(0, 500) || `Issued from template "${template.name || type}"`,
    // Generated by HR from the company template, so nothing to verify.
    status: 'VERIFIED',
    uploadedBy: req.user._id
  });
  const results = await notify({
    tenantId: req.tenantId,
    event: 'DOCUMENT_ISSUED',
    recipients: [{ employeeId: employee._id }],
    actorUserId: req.user._id,
    entityId: String(doc._id),
    channels,
    path: '/account',
    data: { documentName: label, attached: channels.email },
    attachments: channels.email ? [{ filename: `${safeName}.pdf`, contentType: 'application/pdf', contentBase64: pdf.toString('base64') }] : [],
    inApp: { type: 'DOCUMENT_ISSUED', title: `${label} issued`, body: 'HR has added a new document to your account.', link: '/account' }
  });
  await RuleAudit.create({
    tenantId: req.tenantId, module: 'DOCUMENT_TEMPLATE', action: 'ISSUE_DOCUMENT',
    targetId: String(employee._id), after: { type, documentId: doc._id, channels },
    reason: `Issued ${label} to ${employee.employeeCode || employee._id}`, changedBy: req.user._id
  }).catch(() => null);
  const safe = doc.toObject();
  delete safe.dataUrl;
  res.status(201).json({
    message: `${label} filed under ${employee.firstName}'s documents${channels.email || channels.whatsapp ? ' and queued for delivery' : ''}.`,
    document: safe,
    delivery: (results || []).map((r) => ({ channel: r.channel, status: r.status }))
  });
});

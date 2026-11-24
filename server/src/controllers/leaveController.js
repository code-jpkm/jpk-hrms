const asyncHandler = require('../utils/asyncHandler');
const { hasAbility } = require('../middleware/auth');
const ApiError = require('../utils/apiError');
const LeaveBalance = require('../models/LeaveBalance');
const LeavePolicy = require('../models/LeavePolicy');
const LeaveGrant = require('../models/LeaveGrant');
const RuleAudit = require('../models/RuleAudit');
const LeaveRequest = require('../models/LeaveRequest');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const { startOfDay, eachDate } = require('../utils/date');
const { getScopedEmployeeIds, descendantIds } = require('../services/scopeService');
const { notifyLater, recipientsForRoles } = require('../services/messaging/dispatcher');
const { getReportingManager, canApproveEmployee } = require('../services/approvalService');
const { evaluateAttendanceRecord } = require('../services/attendanceRulesService');
const { settleAttendanceChange, withPayrollNote } = require('../services/attendanceChangeService');
const { notifyUser, notifyEmployee, notifyRoles } = require('../services/inAppNotificationService');
const { readWorkbookRows, workbookBuffer, parseImportMonth } = require('../utils/excel');
const { isFingerprintOnly } = require('../services/attendanceModeService');

function inclusiveDays(from, to, dayPart = 'FULL') {
  const a = startOfDay(from);
  const b = startOfDay(to);
  const days = Math.round((b - a) / 86400000) + 1;
  if (days === 1 && ['FIRST_HALF', 'SECOND_HALF'].includes(dayPart)) return 0.5;
  return days;
}

exports.employees = asyncHandler(async (req, res) => {
  const allowedIds = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'LEAVE' });
  const employees = await Employee.find({ tenantId: req.tenantId, _id: { $in: allowedIds }, status: { $ne: 'OFFBOARDED' } })
    .select('employeeCode firstName lastName department designation workLocation employeeCategory canApplyWfh status reportsTo')
    .sort('employeeCode');

  const adminOnBehalf = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role) || hasAbility(req.user, 'LEAVE', 'APPLY_ON_BEHALF');
  const reportIds = new Set(req.employee?._id ? await descendantIds(req.employee._id, req.tenantId) : []);
  const rows = employees.map((employee) => ({
    ...employee.toObject(),
    canApplyOnBehalf: adminOnBehalf
      || String(employee._id) === String(req.employee?._id || '')
      || reportIds.has(String(employee._id))
  }));
  res.json({ employees: rows });
});

exports.policies = asyncHandler(async (req, res) => {
  const policies = await LeavePolicy.find({ tenantId: req.tenantId }).sort('leaveType');
  res.json({ policies });
});

exports.savePolicy = asyncHandler(async (req, res) => {
  const { leaveType, monthlyAccrual = 0, yearlyLimit = 0, carryForward = true, requiresApproval = true, active = true } = req.body;
  if (!leaveType) throw new ApiError(400, 'leaveType is required');
  const before = await LeavePolicy.findOne({ tenantId: req.tenantId, leaveType }).lean();
  const policy = await LeavePolicy.findOneAndUpdate(
    { tenantId: req.tenantId, leaveType },
    { tenantId: req.tenantId, leaveType, monthlyAccrual, yearlyLimit, carryForward, requiresApproval, active },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await RuleAudit.create({ tenantId: req.tenantId, module: 'LEAVE', action: 'SAVE_LEAVE_POLICY', targetId: leaveType, before, after: policy.toObject(), reason: req.body.reason || 'Manual leave type/rule change', changedBy: req.user._id });
  res.json({ policy });
});

async function grantToEmployee({ req, employee, leaveType, days, grantType, reason, referenceDate }) {
  const balance = await LeaveBalance.findOneAndUpdate(
    { tenantId: req.tenantId, employeeId: employee._id, leaveType },
    { $inc: { manualAdjusted: Number(days || 0) }, $setOnInsert: { accrued: 0, used: 0, carriedForward: 0 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const grant = await LeaveGrant.create({ tenantId: req.tenantId, employeeId: employee._id, leaveType, days: Number(days || 0), grantType, reason, referenceDate, grantedBy: req.user._id });
  await RuleAudit.create({ tenantId: req.tenantId, module: 'LEAVE', action: 'EXTRA_LEAVE_GRANT', targetId: String(employee._id), after: { balance, grant }, reason, changedBy: req.user._id });
  return { employeeCode: employee.employeeCode, balance, grant };
}

exports.grant = asyncHandler(async (req, res) => {
  const { employeeId, employeeCode, employeeIds = [], employeeCodes = [], leaveType = 'COMP_OFF', days, grantType = 'MANUAL', reason = '', referenceDate } = req.body;
  if (!days) throw new ApiError(400, 'days is required');
  const ids = [...employeeIds];
  if (employeeId) ids.push(employeeId);
  const codes = [...employeeCodes];
  if (employeeCode) codes.push(employeeCode);
  const q = { tenantId: req.tenantId };
  if (ids.length || codes.length) q.$or = [];
  if (ids.length) q.$or.push({ _id: { $in: ids } });
  if (codes.length) q.$or.push({ employeeCode: { $in: codes } });
  if (!ids.length && !codes.length) throw new ApiError(400, 'Select employeeId or employeeCode');
  const employees = await Employee.find(q);
  const allowed = new Set(await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'LEAVE' }));
  const outside = employees.filter((employee) => !allowed.has(String(employee._id)));
  if (outside.length) throw new ApiError(403, 'One or more employees are outside your Leave Office / Factory scope');
  const results = [];
  for (const employee of employees) results.push(await grantToEmployee({ req, employee, leaveType, days, grantType, reason, referenceDate }));
  res.json({ granted: results.length, results });
});

exports.grants = asyncHandler(async (req, res) => {
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'LEAVE' });
  const grants = await LeaveGrant.find({ tenantId: req.tenantId, employeeId: { $in: allowed } }).populate('employeeId', 'employeeCode firstName lastName').sort('-createdAt').limit(200);
  res.json({ grants });
});

// Opening balances from Excel (moving from greytHR, or a yearly reset). -----

const BALANCE_HEADERS = ['Employee Code', 'Employee Name', 'Leave Type', 'Balance', 'Credited Up To Month', 'Note'];
// Leave type names as greytHR and people write them → the HRMS leave type.
const LEAVE_TYPE_NAMES = {
  EL: 'EL', 'EARNED LEAVE': 'EL', 'EARNED LEAVE F': 'EL', PL: 'EL', 'PRIVILEGE LEAVE': 'EL',
  CL: 'CL', 'CASUAL LEAVE': 'CL',
  SL: 'SL', 'SICK LEAVE': 'SL',
  COMP_OFF: 'COMP_OFF', 'COMP OFF': 'COMP_OFF', COMPOFF: 'COMP_OFF', CO: 'COMP_OFF', 'COMPENSATORY OFF': 'COMP_OFF'
};
const NOT_BALANCES = new Set(['LOP', 'LOSS OF PAY', 'WFH', 'WORK FROM HOME']);
const blank = (v) => v === '' || v === null || v === undefined;
const cellText = (...values) => String(values.find((v) => !blank(v)) ?? '').trim();
const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const typeKey = (value) => String(value || '').toUpperCase().replace(/[\s_-]+/g, ' ').trim();

exports.balanceTemplate = asyncHandler(async (req, res) => {
  const buffer = workbookBuffer({
    sheetName: 'Leave balances',
    headers: BALANCE_HEADERS,
    instructions: [
      'One row per person and leave type. Employee Name is only for you to read.',
      'Leave Type: EL (earned leave), CL, SL or COMP_OFF. The greytHR names (EARNED LEAVE, Earned Leave F, Comp - Off) work too.',
      'Balance: the days the person has today. The HRMS sets the balance to this number (it does not add to it), so uploading the same file twice changes nothing.',
      'Credited Up To Month (EL only, optional): the last month whose monthly EL is already in the balance, for example 2026-11. The HRMS credits from the month after, so no month is counted twice.',
      'Loss of pay and work from home rows are not balances and are skipped.'
    ]
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="JPK-Leave-Balances-Template.xlsx"');
  res.end(buffer);
});

exports.importBalances = asyncHandler(async (req, res) => {
  const rows = readWorkbookRows(req.body.dataUrl, { raw: true });
  const fileName = String(req.body.fileName || 'Excel').slice(0, 120);
  const allowed = new Set((await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'LEAVE' })).map(String));
  const policyTypes = new Set((await LeavePolicy.find({ tenantId: req.tenantId }).select('leaveType').lean()).map((p) => String(p.leaveType).toUpperCase()));
  const result = { updated: 0, unchanged: 0, errors: [], warnings: [] };
  const wanted = new Map();

  rows.forEach((row, index) => {
    const rowNo = index + 2;
    if (Object.values(row).every(blank)) return;
    const typed = cellText(row['Employee Code'], row.employeeCode);
    const code = typed.toUpperCase();
    if (!code) { result.errors.push({ row: rowNo, message: 'Employee Code is empty' }); return; }
    const typedType = cellText(row['Leave Type'], row.leaveType);
    const key = typeKey(typedType);
    if (NOT_BALANCES.has(key)) { result.warnings.push({ row: rowNo, employeeCode: code, message: `${typedType} is not a leave balance, so the row was skipped` }); return; }
    const type = policyTypes.has(typedType.toUpperCase()) ? typedType.toUpperCase() : (LEAVE_TYPE_NAMES[key] || LEAVE_TYPE_NAMES[key.replace(/ /g, '')]);
    if (!type) { result.errors.push({ row: rowNo, employeeCode: code, message: `Leave Type "${typedType}" is not known. Use EL, CL, SL or COMP_OFF.` }); return; }
    const raw = row.Balance ?? row.balance;
    const days = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/,/g, '').trim());
    if (blank(raw) || !Number.isFinite(days) || days < 0) { result.errors.push({ row: rowNo, employeeCode: code, message: `Balance "${raw}" must be a number of days, 0 or more` }); return; }
    const credited = parseImportMonth(row['Credited Up To Month'], { date1904: rows.date1904 });
    if (credited === null) { result.errors.push({ row: rowNo, employeeCode: code, message: `Credited Up To Month "${row['Credited Up To Month']}" is not a month (use 2026-11)` }); return; }
    if (credited && type !== 'EL') result.warnings.push({ row: rowNo, employeeCode: code, message: 'Credited Up To Month is only used for EL' });
    const id = `${code}|${type}`;
    const entry = wanted.get(id);
    if (entry) {
      entry.days = round2(entry.days + days);
      if (credited && type === 'EL' && (!entry.credited || credited > entry.credited)) entry.credited = credited;
      result.warnings.push({ row: rowNo, employeeCode: code, message: `A second ${type} row (from row ${entry.row}): added together, ${entry.days} days in all` });
    } else {
      wanted.set(id, { row: rowNo, typed, code, type, days: round2(days), credited: type === 'EL' ? credited : undefined, note: cellText(row.Note, row.Notes) });
    }
  });

  const codes = [...new Set([...wanted.values()].flatMap((e) => [e.code, e.typed]))];
  const employees = await Employee.find({ tenantId: req.tenantId, employeeCode: { $in: codes } }).select('employeeCode firstName lastName status');
  const byCode = new Map(employees.map((e) => [String(e.employeeCode).toUpperCase(), e]));
  for (const entry of wanted.values()) {
    const employee = byCode.get(entry.code);
    if (!employee || !allowed.has(String(employee._id))) { result.errors.push({ row: entry.row, employeeCode: entry.code, message: 'Not in the HRMS (or outside your leave scope). Import the employee first.' }); continue; }
    if (employee.status === 'OFFBOARDED') { result.warnings.push({ row: entry.row, employeeCode: entry.code, message: 'Has left the company, so the balance was not changed' }); continue; }
    const balance = await LeaveBalance.findOneAndUpdate(
      { tenantId: req.tenantId, employeeId: employee._id, leaveType: entry.type },
      { $setOnInsert: { accrued: 0, used: 0, manualAdjusted: 0, carriedForward: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const delta = round2(entry.days - Number(balance.available || 0));
    let changed = false;
    if (Math.abs(delta) >= 0.001) { balance.manualAdjusted = round2(Number(balance.manualAdjusted || 0) + delta); changed = true; }
    if (entry.credited && (!balance.lastAccruedForMonth || balance.lastAccruedForMonth < entry.credited)) { balance.lastAccruedForMonth = entry.credited; changed = true; }
    if (!changed) { result.unchanged += 1; continue; }
    await balance.save();
    if (Math.abs(delta) >= 0.001) {
      await LeaveGrant.create({ tenantId: req.tenantId, employeeId: employee._id, leaveType: entry.type, days: delta, grantType: 'OPENING_BALANCE', reason: entry.note || `Opening balance (${fileName})`, referenceDate: new Date(), grantedBy: req.user._id });
    }
    result.updated += 1;
  }
  if (result.updated) {
    await RuleAudit.create({ tenantId: req.tenantId, module: 'LEAVE', action: 'IMPORT_LEAVE_BALANCES', after: { updated: result.updated, unchanged: result.unchanged, errors: result.errors.length }, reason: `Leave balances from ${fileName}`, changedBy: req.user._id });
  }
  result.errors.sort((a, b) => a.row - b.row);
  result.warnings.sort((a, b) => a.row - b.row);
  res.json(result);
});

exports.balances = asyncHandler(async (req, res) => {
  const employeeId = req.query.employeeId || req.employee?._id;
  if (!employeeId) throw new ApiError(400, 'employeeId is required');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'LEAVE' });
  if (!allowed.includes(String(employeeId))) throw new ApiError(403, 'Leave balance is outside your scope');
  const balances = await LeaveBalance.find({ tenantId: req.tenantId, employeeId });
  res.json({ balances });
});

exports.requests = asyncHandler(async (req, res) => {
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'LEAVE' });
  const q = { tenantId: req.tenantId, employeeId: { $in: allowed } };
  if (req.query.status) q.status = req.query.status;
  const requests = await LeaveRequest.find(q).populate('employeeId', 'employeeCode firstName lastName department reportsTo').populate('approverEmployeeId', 'employeeCode firstName lastName').sort('-createdAt');
  res.json({ requests });
});

async function resolveRequestEmployee(req, resource = 'LEAVE', input = req.body || {}) {
  const { employeeId, employeeCode } = input;
  if (!employeeId && !employeeCode) {
    if (!req.employee) throw new ApiError(400, 'No employee profile linked');
    return { employee: req.employee, appliedOnBehalf: false };
  }

  const employee = await Employee.findOne({ tenantId: req.tenantId, ...(employeeId ? { _id: employeeId } : { employeeCode }) });
  if (!employee) throw new ApiError(404, 'Employee not found for on-behalf request');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource });
  if (!allowed.map(String).includes(String(employee._id))) throw new ApiError(403, 'This employee is outside your allowed Office / Factory scope');

  const isSelf = req.employee && String(req.employee._id) === String(employee._id);
  if (!isSelf && !['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)) {
    const explicitlyAllowed = hasAbility(req.user, 'LEAVE', 'APPLY_ON_BEHALF');
    const managerAllowed = await canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: employee });
    if (!explicitlyAllowed && !managerAllowed) throw new ApiError(403, 'You can apply leave only for employees in your reporting team');
  }
  return { employee, appliedOnBehalf: !isSelf };
}

async function applyApprovedRequest(request, tenantId, decidedBy) {
  const employeeId = request.employeeId?._id || request.employeeId;
  if (request.requestType === 'LEAVE') {
    if (String(request.leaveType).toUpperCase() !== 'LOP') {
      await LeaveBalance.findOneAndUpdate(
        { tenantId, employeeId, leaveType: request.leaveType },
        { $inc: { used: request.days } },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }
    for (const date of eachDate(request.fromDate, request.toDate)) {
      const unpaid = String(request.leaveType).toUpperCase() === 'LOP';
      const lopDays = request.dayPart === 'FULL' ? 1 : 0.5;
      const patch = {
        status: 'LEAVE',
        dayPart: request.dayPart,
        source: 'SYSTEM',
        deductionReason: unpaid ? 'Unpaid leave (LOP) approved' : `${request.leaveType} leave approved`
      };
      if (unpaid) {
        patch.lopOverride = {
          enabled: true,
          originalLopDays: lopDays,
          overrideLopDays: lopDays,
          reason: 'Approved unpaid leave (LOP)',
          category: 'MANAGEMENT_APPROVAL',
          overriddenBy: decidedBy,
          overriddenAt: new Date()
        };
      }
      const leaveAttendance = await Attendance.findOneAndUpdate(
        { tenantId, employeeId, date: startOfDay(date) },
        { $set: patch },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      await evaluateAttendanceRecord(leaveAttendance);
    }
  } else if (request.requestType === 'WFH') {
    for (const date of eachDate(request.fromDate, request.toDate)) {
      const wfhAttendance = await Attendance.findOneAndUpdate(
        { tenantId, employeeId, date: startOfDay(date) },
        { $set: { status: 'WFH', source: 'WFH', deductionReason: 'Work from home approved' } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      await evaluateAttendanceRecord(wfhAttendance);
    }
  }
}

/** "YYYY-MM-DD" (or any date) -> UTC midnight of that calendar day, or null. */
function wholeDay(value) {
  if (!value) return null;
  const s = String(value).trim();
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = ymd ? new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

/** Days already promised to PENDING requests, so three overlapping requests cannot each pass the balance check. */
async function pendingDays({ tenantId, employeeId, leaveType, excludeId }) {
  const rows = await LeaveRequest.find({ tenantId, employeeId, requestType: 'LEAVE', leaveType, status: 'PENDING', ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('days').lean();
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row.days || 0)), 0);
}

/**
 * Whether the person submitting may approve this request themselves. A Super
 * Admin, HR, an explicit LEAVE:APPROVE holder or the employee's reporting
 * manager applying ON BEHALF of someone is the approver, so sending it back to
 * their own inbox only adds a pointless second click. A Super Admin's own
 * request has nobody above it.
 */
async function submitterCanApprove(req, employee, appliedOnBehalf) {
  if (!appliedOnBehalf) return req.user.role === 'SUPER_ADMIN';
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)) return true;
  if (hasAbility(req.user, 'LEAVE', 'APPROVE')) return true;
  return canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: employee });
}

function roleLabel(role) {
  return { SUPER_ADMIN: 'Super Admin', HR_ADMIN: 'HR', MANAGER: 'Manager' }[role] || 'an approver';
}

/**
 * The single path that creates a leave / WFH request, used by the leave form
 * and the AI copilot alike. `input.sendForApproval === true` keeps the normal
 * approval flow even when the submitter could approve it.
 */
async function submitLeaveRequest(req, input = {}) {
  const { employee, appliedOnBehalf } = await resolveRequestEmployee(req, 'LEAVE', input);
  const { requestType = 'LEAVE', fromDate, toDate, dayPart = 'FULL', reason } = input;
  const leaveType = String(input.leaveType || 'EL').toUpperCase();
  if (!['LEAVE', 'WFH'].includes(requestType)) throw new ApiError(400, 'Request type must be LEAVE or WFH');
  if (!['FULL', 'FIRST_HALF', 'SECOND_HALF'].includes(dayPart)) throw new ApiError(400, 'Day part must be FULL, FIRST_HALF or SECOND_HALF');
  const from = wholeDay(fromDate);
  const to = wholeDay(toDate || fromDate);
  if (!from) throw new ApiError(400, 'From date is required');
  if (!to) throw new ApiError(400, 'To date is not a valid date');
  // v26: a "to" date before the "from" date produced a request for NEGATIVE days,
  // and approving it ADDED that many days back to the balance.
  if (to < from) throw new ApiError(400, 'The end date cannot be before the start date');
  if ((to - from) / 86400000 > 92) throw new ApiError(400, 'A single request can cover at most 3 months. Split longer absences.');
  if (dayPart !== 'FULL' && to.getTime() !== from.getTime()) throw new ApiError(400, 'Half-day requests must be for a single date');
  if (requestType === 'WFH' && (employee.canApplyWfh !== true || await isFingerprintOnly(employee, req.tenantId))) throw new ApiError(403, 'Work from home is not enabled for this employee');
  const days = inclusiveDays(from, to, dayPart);

  // Overlapping requests double-booked the same days (and the same balance).
  const overlap = await LeaveRequest.findOne({ tenantId: req.tenantId, employeeId: employee._id, status: { $in: ['PENDING', 'APPROVED'] }, fromDate: { $lte: to }, toDate: { $gte: from } }).lean();
  if (overlap) {
    const sameHalf = overlap.dayPart !== 'FULL' && dayPart !== 'FULL' && overlap.dayPart !== dayPart && days === 0.5 && Number(overlap.days) === 0.5;
    if (!sameHalf) throw new ApiError(409, `These dates overlap an existing ${String(overlap.status).toLowerCase()} ${overlap.requestType === 'WFH' ? 'WFH' : overlap.leaveType} request (${new Date(overlap.fromDate).toISOString().slice(0, 10)} to ${new Date(overlap.toDate).toISOString().slice(0, 10)}). Cancel it first or choose other dates.`);
  }

  if (requestType === 'LEAVE' && leaveType !== 'LOP') {
    const balance = await LeaveBalance.findOne({ tenantId: req.tenantId, employeeId: employee._id, leaveType });
    const available = Number(balance?.available ?? 0);
    const promised = await pendingDays({ tenantId: req.tenantId, employeeId: employee._id, leaveType });
    if (available - promised < days) {
      throw new ApiError(400, promised
        ? `Not enough ${leaveType} balance. Available: ${available}, already requested and pending: ${promised}.`
        : `Not enough ${leaveType} balance. Available: ${available}`);
    }
  }

  const manager = await getReportingManager(employee);
  const autoApprove = input.sendForApproval === true ? false : await submitterCanApprove(req, employee, appliedOnBehalf);
  const approvedNote = appliedOnBehalf
    ? `Applied on behalf of the employee and approved by ${req.user.name || roleLabel(req.user.role)} (${roleLabel(req.user.role)})`
    : 'Approved automatically: applied by the Super Admin';
  const request = await LeaveRequest.create({
    tenantId: req.tenantId,
    employeeId: employee._id,
    requestType,
    leaveType: requestType === 'WFH' ? 'WFH' : leaveType,
    fromDate: from,
    toDate: to,
    dayPart,
    days,
    reason,
    approverEmployeeId: manager?._id,
    appliedByUserId: req.user._id,
    appliedOnBehalf,
    status: autoApprove ? 'APPROVED' : 'PENDING',
    decidedBy: autoApprove ? req.user._id : undefined,
    decidedAt: autoApprove ? new Date() : undefined,
    decisionRemarks: autoApprove ? approvedNote : undefined
  });

  const name = `${employee.firstName} ${employee.lastName || ''}`.trim();
  const label = requestType === 'WFH' ? 'WFH' : request.leaveType;
  const eventData = { employeeName: name, employeeCode: employee.employeeCode, leaveType: request.leaveType, requestType, fromDate: request.fromDate, toDate: request.toDate, days: request.days, reason: reason || '' };
  if (autoApprove) {
    await applyApprovedRequest(request, req.tenantId, req.user._id);
    notifyLater({
      tenantId: req.tenantId, event: 'LEAVE_DECIDED', recipients: [{ employeeId: employee._id }], path: '/leave', entityId: `${request._id}:APPROVED`, actorUserId: req.user._id,
      data: { ...eventData, status: 'APPROVED', decidedBy: req.user.name, remarks: appliedOnBehalf ? `Recorded for you by ${req.user.name || roleLabel(req.user.role)}` : '' },
      inApp: { type: 'LEAVE_APPROVED', title: `${label} approved`, body: appliedOnBehalf ? `${req.user.name || roleLabel(req.user.role)} recorded ${request.days} day(s) of ${label} for you. No action needed.` : `Your ${request.days} day(s) of ${label} is approved.`, entityType: 'LEAVE_REQUEST' }
    });
  } else if (manager?.userId) {
    notifyLater({
      tenantId: req.tenantId, event: 'LEAVE_SUBMITTED', recipients: [{ userId: manager.userId._id, employeeId: manager._id }], path: '/leave', entityId: request._id, actorUserId: req.user._id, data: eventData,
      inApp: { type: 'LEAVE_REQUEST', title: `New ${label} request`, body: `${name} requested ${request.days} day(s). ${reason || ''}`.trim(), entityType: 'LEAVE_REQUEST', priority: 'HIGH' }
    });
  } else {
    notifyLater({
      tenantId: req.tenantId, event: 'LEAVE_SUBMITTED', recipients: await recipientsForRoles(req.tenantId, ['SUPER_ADMIN', 'HR_ADMIN']), path: '/leave', entityId: request._id, actorUserId: req.user._id, data: eventData,
      inApp: { type: 'LEAVE_REQUEST', title: `Unassigned ${label} request`, body: `${name} has no reporting-manager portal account. Review the request.`, entityType: 'LEAVE_REQUEST', priority: 'HIGH' }
    });
  }

  return { request, employee, autoApproved: autoApprove, appliedOnBehalf, label, name };
}

exports.submitLeaveRequest = submitLeaveRequest;

exports.apply = asyncHandler(async (req, res) => {
  const { request, autoApproved, appliedOnBehalf, label, name } = await submitLeaveRequest(req, req.body || {});
  let message = autoApproved
    ? (appliedOnBehalf ? `Approved. ${request.days} day(s) of ${label} recorded for ${name}.` : `Approved. ${request.days} day(s) of ${label} recorded.`)
    : 'Request sent for approval';
  let payroll = [];
  if (autoApproved) {
    const settled = await settleAttendanceChange(req, { employeeIds: [request.employeeId], dates: [request.fromDate, request.toDate] });
    payroll = settled.payroll;
    message = withPayrollNote(message, settled.payrollNote);
  }
  res.status(201).json({ request, autoApproved, message, payroll });
});

exports.manualAdd = asyncHandler(async (req, res) => {
  const { employeeId, employeeCode, leaveType = 'EL', days, remarks, grantType = 'MANUAL' } = req.body;
  const employee = await Employee.findOne({ tenantId: req.tenantId, ...(employeeId ? { _id: employeeId } : { employeeCode }) });
  if (!employee) throw new ApiError(404, 'Employee not found');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'LEAVE' });
  if (!allowed.includes(String(employee._id))) throw new ApiError(403, 'Employee is outside your Leave Office / Factory scope');
  const result = await grantToEmployee({ req, employee, leaveType, days, grantType, reason: remarks, referenceDate: new Date() });
  res.json({ balance: result.balance, grant: result.grant, remarks });
});

/**
 * Approve or reject a pending leave / WFH request. Used by the leave screen and
 * by the attendance calendar, so both apply the same checks.
 */
async function decideLeaveRequest(req, id, { status, remarks } = {}) {
  if (!['APPROVED', 'REJECTED'].includes(status)) throw new ApiError(400, 'status must be APPROVED or REJECTED');
  const request = await LeaveRequest.findOne({ _id: id, tenantId: req.tenantId }).populate('employeeId');
  if (!request) throw new ApiError(404, 'Leave request not found');
  const visible = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'LEAVE' });
  if (!visible.includes(String(request.employeeId?._id || request.employeeId))) throw new ApiError(403, 'Leave request is outside your Office / Factory scope');
  const allowed = await canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: request.employeeId });
  if (!allowed) throw new ApiError(403, 'Only reporting manager, HR or admin can decide leave/WFH');
  if (request.status !== 'PENDING') throw new ApiError(400, 'Request already decided');
  const ownRequest = req.employee && String(request.employeeId?._id || request.employeeId) === String(req.employee._id);
  if (ownRequest && req.user.role !== 'SUPER_ADMIN') throw new ApiError(403, 'You cannot decide your own leave request. It goes to your reporting manager or HR.');
  if (Number(request.days) <= 0) throw new ApiError(400, 'This request has an invalid date range. Reject it and ask for a new request.');
  // Balance may have changed since the request was submitted (another approval,
  // an adjustment). Approving beyond the balance used to drive it negative.
  if (status === 'APPROVED' && request.requestType === 'LEAVE' && String(request.leaveType).toUpperCase() !== 'LOP') {
    const balance = await LeaveBalance.findOne({ tenantId: req.tenantId, employeeId: request.employeeId._id, leaveType: request.leaveType });
    const available = Number(balance?.available ?? 0);
    if (available < Number(request.days)) throw new ApiError(400, `${request.employeeId.firstName} now has only ${available} ${request.leaveType} day(s) available for a ${request.days}-day request. Reject it, or grant leave first.`);
  }
  request.status = status;
  request.decidedBy = req.user._id;
  request.decidedAt = new Date();
  request.decisionRemarks = remarks;
  await request.save();

  if (status === 'APPROVED') await applyApprovedRequest(request, req.tenantId, req.user._id);

  notifyLater({
    tenantId: req.tenantId,
    event: 'LEAVE_DECIDED',
    recipients: [{ employeeId: request.employeeId._id }],
    path: '/leave',
    entityId: `${request._id}:${status}`,
    actorUserId: req.user._id,
    data: { employeeName: `${request.employeeId.firstName || ''} ${request.employeeId.lastName || ''}`.trim(), leaveType: request.leaveType, requestType: request.requestType, fromDate: request.fromDate, toDate: request.toDate, days: request.days, status, decidedBy: req.user.name, remarks: remarks || '' },
    inApp: {
      type: status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
      title: `${request.requestType === 'WFH' ? 'WFH' : request.leaveType} ${status.toLowerCase()}`,
      body: remarks || `Your ${request.days} day request was ${status.toLowerCase()}.`,
      entityType: 'LEAVE_REQUEST',
      priority: status === 'REJECTED' ? 'HIGH' : 'NORMAL'
    }
  });
  return { request, message: `Request ${status.toLowerCase()}` };
}

exports.decideLeaveRequest = decideLeaveRequest;

exports.decision = asyncHandler(async (req, res) => {
  const { request, message } = await decideLeaveRequest(req, req.params.id, req.body || {});
  let payroll = [];
  let text = message;
  if (request.status === 'APPROVED') {
    const settled = await settleAttendanceChange(req, { employeeIds: [request.employeeId?._id || request.employeeId], dates: [request.fromDate, request.toDate] });
    payroll = settled.payroll;
    text = withPayrollNote(message, settled.payrollNote);
  }
  res.json({ request, message: text, payroll });
});

/**
 * v26: cancel a leave / WFH request.
 *  - PENDING: the employee, their approver or HR can withdraw it.
 *  - APPROVED: HR / admin only; the balance is returned and the attendance days
 *    the approval had written as LEAVE / WFH are restored.
 */
exports.cancel = asyncHandler(async (req, res) => {
  const request = await LeaveRequest.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate('employeeId');
  if (!request) throw new ApiError(404, 'Leave request not found');
  const visible = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'LEAVE' });
  if (!visible.includes(String(request.employeeId?._id || request.employeeId))) throw new ApiError(403, 'Leave request is outside your scope');
  const own = req.employee && String(request.employeeId._id) === String(req.employee._id);
  const admin = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role) || hasAbility(req.user, 'LEAVE', 'MANAGE');
  const reason = String(req.body?.reason || '').trim().slice(0, 300);

  if (request.status === 'PENDING') {
    if (!own && !admin && !(await canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: request.employeeId }))) {
      throw new ApiError(403, 'Only the employee, their approver or HR can withdraw this request');
    }
  } else if (request.status === 'APPROVED') {
    if (!admin) throw new ApiError(403, 'An approved request can only be cancelled by HR. Ask HR to cancel it.');
    if (!reason) throw new ApiError(400, 'Give a reason for cancelling an approved request');
    const employeeId = request.employeeId._id;
    if (request.requestType === 'LEAVE' && String(request.leaveType).toUpperCase() !== 'LOP') {
      await LeaveBalance.findOneAndUpdate({ tenantId: req.tenantId, employeeId, leaveType: request.leaveType }, { $inc: { used: -Math.max(0, Number(request.days || 0)) } });
    }
    for (const date of eachDate(request.fromDate, request.toDate)) {
      const row = await Attendance.findOne({ tenantId: req.tenantId, employeeId, date: startOfDay(date) });
      if (!row || !['LEAVE', 'WFH'].includes(row.status)) continue;
      if (row.checkIn) {
        row.status = 'PRESENT';
        row.dayPart = 'FULL';
        if (row.lopOverride?.enabled && /leave/i.test(row.lopOverride.reason || '')) row.lopOverride.enabled = false;
        row.deductionReason = 'Leave cancelled; day re-evaluated from punches';
        await row.save();
        await evaluateAttendanceRecord(row);
      } else {
        await row.deleteOne();
      }
    }
  } else {
    throw new ApiError(400, `A ${String(request.status).toLowerCase()} request cannot be cancelled`);
  }

  const previous = request.status;
  request.status = 'CANCELLED';
  request.decidedBy = req.user._id;
  request.decidedAt = new Date();
  request.decisionRemarks = reason || (own ? 'Withdrawn by employee' : 'Cancelled');
  await request.save();
  await RuleAudit.create({ tenantId: req.tenantId, module: 'LEAVE', action: previous === 'APPROVED' ? 'CANCEL_APPROVED_LEAVE' : 'WITHDRAW_LEAVE', targetId: String(request._id), reason: request.decisionRemarks, changedBy: req.user._id }).catch(() => {});

  if (!own) {
    notifyLater({
      tenantId: req.tenantId,
      event: 'LEAVE_DECIDED',
      recipients: [{ employeeId: request.employeeId._id }],
      path: '/leave',
      entityId: `${request._id}:CANCELLED`,
      actorUserId: req.user._id,
      data: { employeeName: `${request.employeeId.firstName || ''} ${request.employeeId.lastName || ''}`.trim(), leaveType: request.leaveType, requestType: request.requestType, fromDate: request.fromDate, toDate: request.toDate, days: request.days, status: 'CANCELLED', decidedBy: req.user.name, remarks: request.decisionRemarks },
      inApp: { type: 'LEAVE_CANCELLED', title: `${request.requestType === 'WFH' ? 'WFH' : request.leaveType} cancelled`, body: request.decisionRemarks, entityType: 'LEAVE_REQUEST' }
    });
  }
  let message = previous === 'APPROVED' ? 'Approved leave cancelled and balance restored' : 'Request withdrawn';
  let payroll = [];
  if (previous === 'APPROVED') {
    const settled = await settleAttendanceChange(req, { employeeIds: [request.employeeId?._id || request.employeeId], dates: [request.fromDate, request.toDate] });
    payroll = settled.payroll;
    message = withPayrollNote(message, settled.payrollNote);
  }
  res.json({ request, message, payroll });
});

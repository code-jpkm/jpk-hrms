const PDFDocument = require('pdfkit');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Holiday = require('../models/Holiday');
const ShiftAssignment = require('../models/ShiftAssignment');
const PayrollRule = require('../models/PayrollRule');
const PayrollRun = require('../models/PayrollRun');
const SalaryMaster = require('../models/SalaryMaster');
const SalarySlip = require('../models/SalarySlip');
const PayslipTemplate = require('../models/PayslipTemplate');
const RuleAudit = require('../models/RuleAudit');
const { monthRange, eachDate, startOfDay, endOfDay, dateKey, holidayDateKey, holidayAppliesTo, companyToday } = require('../utils/date');
const { calculateSalary, calculateStatutoryDeductions, roundMoney } = require('../utils/salary');
const { readWorkbookRows, workbookBuffer } = require('../utils/excel');
const { workbookBuffer: xlsxBook, columnLetter } = require('../utils/xlsxWriter');
const { payslipFileName, attachmentHeader } = require('../utils/payslipName');
const Tenant = require('../models/Tenant');
const { getActiveSalaryMastersMap } = require('../services/salaryMasterService');
const { buildSlip, recalculateRunSummary } = require('../services/payrollSlipService');
const { applySlipEdits, calculatedOf, payslipLines, editsFromRequest, rupeesInWords } = require('../services/payslipModel');
const { evaluateMonth } = require('../services/attendanceRulesService');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { writePayslipPdfToStream, payslipPdfBuffer, getActivePayslipTemplate } = require('../services/payslipPdfService');
const { notify, notifyLater, recipientsForRoles } = require('../services/messaging/dispatcher');
const { randomToken, hashToken } = require('../utils/security');
const env = require('../config/env');
const { hasAbility } = require('../middleware/auth');
const { notifyEmployee, notifyRoles } = require('../services/inAppNotificationService');
const { payrollLockOn, isMonthOpen, monthOpensOn, companyTodayKey, lockedReason, monthName } = require('../services/payrollLockService');

function csvEscape(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function salarySheetRows(req, runId) {
  const runDoc = await PayrollRun.findOne({ _id: runId, tenantId: req.tenantId });
  if (!runDoc) throw new ApiError(404, 'Payroll run not found');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  const slips = await SalarySlip.find({ tenantId: req.tenantId, payrollRunId: runDoc._id, employeeId: { $in: allowed } }).populate('employeeId', 'employeeCode firstName lastName department designation');
  const rows = slips.map((s) => ({
    employeeCode: s.employeeId?.employeeCode || '',
    name: `${s.employeeId?.firstName || ''} ${s.employeeId?.lastName || ''}`.trim(),
    department: s.employeeId?.department || '',
    designation: s.employeeId?.designation || '',
    workingDays: s.attendanceStats?.workingDays || 0,
    payableDays: s.attendanceStats?.payableDays || 0,
    lopDays: s.attendanceStats?.attendanceLopDays || 0,
    basic: s.earnings?.basic || 0,
    hra: s.earnings?.hra || 0,
    conveyance: s.earnings?.conveyance || 0,
    specialAllowance: s.earnings?.specialAllowance || 0,
    // Paid gross: salary parts plus any extra earning lines (bonus, arrears…) HR added.
    gross: s.earnings?.total ?? s.earnings?.proratedGross ?? 0,
    otherEarnings: roundMoney(Number(s.earnings?.total ?? s.earnings?.proratedGross ?? 0) - Number(s.earnings?.basic || 0) - Number(s.earnings?.hra || 0) - Number(s.earnings?.conveyance || 0) - Number(s.earnings?.specialAllowance || 0)),
    pf: s.deductions?.pf || 0,
    esi: s.deductions?.esi || 0,
    ptax: s.deductions?.ptax || 0,
    loan: s.deductions?.loan || 0,
    otherDeductions: roundMoney(Number(s.deductions?.total || 0) - Number(s.deductions?.pf || 0) - Number(s.deductions?.esi || 0) - Number(s.deductions?.ptax || 0) - Number(s.deductions?.loan || 0)),
    totalDeductions: s.deductions?.total || 0,
    netPay: s.netPay || 0
  }));
  const run = runDoc.toObject();
  run.summary = {
    employeeCount: slips.length,
    grossTotal: roundMoney(slips.reduce((sum, slip) => sum + Number(slip.earnings?.total ?? slip.earnings?.proratedGross ?? 0), 0)),
    deductionTotal: roundMoney(slips.reduce((sum, slip) => sum + Number(slip.deductions?.total || 0), 0)),
    netTotal: roundMoney(slips.reduce((sum, slip) => sum + Number(slip.netPay || 0), 0))
  };
  return { run, rows };
}


/**
 * Money from a form or an Excel cell. Excel hands formatted text to the importer, so
 * "10,500" and "₹ 10,500" must read as 10500 (they used to become 0 and the row failed
 * with a negative net salary). Non-numeric text stays NaN so the row is refused.
 */
function n(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/₹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
  return cleaned ? Number(cleaned) : 0;
}
function normalizeSalaryMasterBody(body) {
  const srcEarnings = body.earnings || {};
  const srcDeductions = body.deductions || {};
  const earnings = {
    basic: n(srcEarnings.basic ?? body.basic),
    hra: n(srcEarnings.hra ?? body.hra),
    conveyance: n(srcEarnings.conveyance ?? body.conveyance),
    specialAllowance: n(srcEarnings.specialAllowance ?? body.specialAllowance),
    otherEarnings: n(srcEarnings.otherEarnings ?? body.otherEarnings)
  };
  const deductions = {
    pf: n(srcDeductions.pf ?? body.pf),
    esi: n(srcDeductions.esi ?? body.esi),
    ptax: n(srcDeductions.ptax ?? body.ptax),
    otherDeductions: n(srcDeductions.otherDeductions ?? body.otherDeductions)
  };
  const grossSalary = earnings.basic + earnings.hra + earnings.conveyance + earnings.specialAllowance + earnings.otherEarnings;
  const totalDeductions = deductions.pf + deductions.esi + deductions.ptax + deductions.otherDeductions;
  return {
    employeeId: body.employeeId,
    effectiveMonth: body.effectiveMonth,
    earnings,
    deductions,
    grossSalary,
    totalDeductions,
    netSalary: grossSalary - totalDeductions,
    calculationMode: body.calculationMode || 'RULE_BASED_DEDUCTIONS',
    notes: body.notes || '',
    locked: Boolean(body.locked)
  };
}


async function activePayrollRule(tenantId) {
  return PayrollRule.findOneAndUpdate(
    { tenantId, active: true },
    { $setOnInsert: { tenantId, active: true, name: 'Default Payroll Rule' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function autoSalaryPayload({ tenantId, employee, payload }) {
  if (payload.calculationMode !== 'RULE_BASED_DEDUCTIONS') return payload;
  const rule = await activePayrollRule(tenantId);
  const draft = { ...payload, deductions: { ...(payload.deductions || {}) } };
  const statutory = calculateStatutoryDeductions({ employee, rule, salaryMaster: draft });
  payload.deductions = {
    pf: statutory.pf,
    esi: statutory.esi,
    ptax: statutory.ptax,
    otherDeductions: Number(payload.deductions?.otherDeductions || 0)
  };
  payload.totalDeductions = payload.deductions.pf + payload.deductions.esi + payload.deductions.ptax + payload.deductions.otherDeductions;
  payload.netSalary = payload.grossSalary - payload.totalDeductions;
  return payload;
}

function normalizeExcelSalaryRow(row) {
  return {
    employeeCode: String(row.employeeCode || row['Employee Code'] || row['EmployeeCode'] || '').trim(),
    effectiveMonth: String(row.effectiveMonth || row['Effective Month'] || row['EffectiveMonth'] || '').trim(),
    earnings: {
      basic: n(row.basic ?? row['Basic']),
      hra: n(row.hra ?? row['HRA']),
      conveyance: n(row.conveyance ?? row['Conveyance']),
      specialAllowance: n(row.specialAllowance ?? row['Special Allowance']),
      otherEarnings: n(row.otherEarnings ?? row['Other Earnings'])
    },
    deductions: { otherDeductions: n(row.otherDeductions ?? row['Other Deductions']) },
    calculationMode: String(row.calculationMode || row['Calculation Mode'] || 'RULE_BASED_DEDUCTIONS').trim().toUpperCase(),
    notes: String(row.notes || row['Notes'] || 'Excel salary import').trim()
  };
}

exports.employees = asyncHandler(async (req, res) => {
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  const employees = await Employee.find({ tenantId: req.tenantId, _id: { $in: allowed }, status: { $ne: 'OFFBOARDED' } })
    .select('employeeCode firstName lastName department designation workLocation employeeCategory statutory.pfApplicable statutory.esiApplicable statutory.ptaxApplicable status')
    .sort('employeeCode');
  res.json({ employees });
});

exports.salaryMasters = asyncHandler(async (req, res) => {
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  const q = { tenantId: req.tenantId, employeeId: { $in: allowed } };
  if (req.query.employeeId) {
    if (!allowed.includes(String(req.query.employeeId))) throw new ApiError(403, 'Salary master is outside your Office / Factory scope');
    q.employeeId = req.query.employeeId;
  }
  if (req.query.effectiveMonth) q.effectiveMonth = req.query.effectiveMonth;
  if (req.query.activeAt) q.effectiveMonth = { $lte: req.query.activeAt };
  let masters = await SalaryMaster.find(q).populate('employeeId', 'employeeCode firstName lastName department designation').sort('employeeId -effectiveMonth -updatedAt');
  if (req.query.activeAt) {
    const seen = new Set();
    masters = masters.filter((m) => {
      const key = String(m.employeeId?._id || m.employeeId);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  res.json({ salaryMasters: masters });
});

exports.upsertSalaryMaster = asyncHandler(async (req, res) => {
  const payload = normalizeSalaryMasterBody(req.body);
  if (!payload.employeeId) throw new ApiError(400, 'Employee is required');
  if (!/^\d{4}-\d{2}$/.test(payload.effectiveMonth || '')) throw new ApiError(400, 'Effective month must be YYYY-MM');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  if (!allowed.includes(String(payload.employeeId))) throw new ApiError(403, 'Employee salary is outside your Office / Factory scope');
  const employee = await Employee.findOne({ _id: payload.employeeId, tenantId: req.tenantId });
  if (!employee) throw new ApiError(404, 'Employee not found');
  await autoSalaryPayload({ tenantId: req.tenantId, employee, payload });
  const before = await SalaryMaster.findOne({ tenantId: req.tenantId, employeeId: payload.employeeId, effectiveMonth: payload.effectiveMonth }).lean();
  if (before?.locked && req.user.role !== 'SUPER_ADMIN') throw new ApiError(403, 'This salary master is locked. Only super admin can change it.');
  const master = await SalaryMaster.findOneAndUpdate(
    { tenantId: req.tenantId, employeeId: payload.employeeId, effectiveMonth: payload.effectiveMonth },
    { ...payload, tenantId: req.tenantId, updatedBy: req.user._id, ...(before ? {} : { createdBy: req.user._id }) },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).populate('employeeId', 'employeeCode firstName lastName department designation');

  // Keep old employee.salary fields in sync so old screens still show basic/gross.
  employee.salary = {
    ...(employee.salary || {}),
    basic: master.earnings.basic,
    hra: master.earnings.hra,
    conveyance: master.earnings.conveyance,
    specialAllowance: master.earnings.specialAllowance,
    allowances: master.earnings.otherEarnings,
    gross: master.grossSalary,
    pfNumber: employee.salary?.pfNumber,
    esiNumber: employee.salary?.esiNumber,
    pan: employee.salary?.pan,
    bankAccountLast4: employee.salary?.bankAccountLast4
  };
  await employee.save();
  await RuleAudit.create({ tenantId: req.tenantId, module: 'SALARY_MASTER', action: before ? 'UPDATE_SALARY_MASTER' : 'CREATE_SALARY_MASTER', targetId: String(master._id), before, after: master.toObject(), reason: payload.notes || 'Manual salary master change', changedBy: req.user._id });
  res.status(before ? 200 : 201).json({ salaryMaster: master });
});

exports.bulkUpsertSalaryMasters = asyncHandler(async (req, res) => {
  const rows = req.body.rows || [];
  if (!Array.isArray(rows) || !rows.length) throw new ApiError(400, 'rows array is required');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  const results = [];
  for (const row of rows) {
    const code = String(row.employeeCode || row.code || '').trim();
    const employee = await Employee.findOne({ tenantId: req.tenantId, employeeCode: code, _id: { $in: allowed } });
    if (!employee) {
      results.push({ employeeCode: code, status: 'SKIPPED', reason: 'Employee not found or outside salary scope' });
      continue;
    }
    const payload = normalizeSalaryMasterBody({ ...row, employeeId: employee._id });
    await autoSalaryPayload({ tenantId: req.tenantId, employee, payload });
    if (!/^\d{4}-\d{2}$/.test(payload.effectiveMonth || '')) {
      results.push({ employeeCode: code, status: 'SKIPPED', reason: 'effectiveMonth must be YYYY-MM' });
      continue;
    }
    const master = await SalaryMaster.findOneAndUpdate(
      { tenantId: req.tenantId, employeeId: employee._id, effectiveMonth: payload.effectiveMonth },
      { ...payload, tenantId: req.tenantId, updatedBy: req.user._id },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    employee.salary = { ...(employee.salary || {}), basic: master.earnings.basic, hra: master.earnings.hra, conveyance: master.earnings.conveyance, specialAllowance: master.earnings.specialAllowance, allowances: master.earnings.otherEarnings, gross: master.grossSalary };
    await employee.save();
    results.push({ employeeCode: code, status: 'SAVED', grossSalary: master.grossSalary, netSalary: master.netSalary });
  }
  res.json({ saved: results.filter((r) => r.status === 'SAVED').length, results });
});


exports.salaryImportTemplate = asyncHandler(async (req, res) => {
  const headers = ['Employee Code','Effective Month','Basic','HRA','Conveyance','Special Allowance','Other Earnings','Other Deductions','Calculation Mode','Notes'];
  const buffer = workbookBuffer({
    sheetName: 'Salary Masters', headers,
    instructions: [
      'PF, ESI and Professional Tax are intentionally not input columns: HRMS calculates them automatically from the active payroll rule and each employee statutory applicability.',
      'Effective Month format: YYYY-MM.',
      'Calculation Mode should normally remain RULE_BASED_DEDUCTIONS.',
      'Existing Employee Code + Effective Month rows are updated; new months are created.'
    ]
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="JPK-Salary-Master-Import-Template.xlsx"');
  res.end(buffer);
});

exports.importSalaryMastersExcel = asyncHandler(async (req, res) => {
  const rows = readWorkbookRows(req.body.dataUrl).map(normalizeExcelSalaryRow).filter((row) => row.employeeCode);
  if (!rows.length) throw new ApiError(400, 'No salary rows found in the first Excel sheet');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  const results = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    try {
      const employee = await Employee.findOne({ tenantId: req.tenantId, employeeCode: row.employeeCode, _id: { $in: allowed } });
      if (!employee) throw new Error('Employee not found or outside salary scope');
      const payload = normalizeSalaryMasterBody({ ...row, employeeId: employee._id });
      if (!/^\d{4}-\d{2}$/.test(payload.effectiveMonth || '')) throw new Error('Effective Month must be YYYY-MM');
      await autoSalaryPayload({ tenantId: req.tenantId, employee, payload });
      const master = await SalaryMaster.findOneAndUpdate(
        { tenantId: req.tenantId, employeeId: employee._id, effectiveMonth: payload.effectiveMonth },
        { ...payload, tenantId: req.tenantId, updatedBy: req.user._id },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      employee.salary = { ...(employee.salary || {}), basic: master.earnings.basic, hra: master.earnings.hra, conveyance: master.earnings.conveyance, specialAllowance: master.earnings.specialAllowance, allowances: master.earnings.otherEarnings, gross: master.grossSalary };
      await employee.save();
      results.push({ row: index + 2, employeeCode: row.employeeCode, status: 'SAVED', grossSalary: master.grossSalary, pf: master.deductions.pf, esi: master.deductions.esi, ptax: master.deductions.ptax, netSalary: master.netSalary });
    } catch (error) {
      results.push({ row: index + 2, employeeCode: row.employeeCode, status: 'ERROR', reason: error.message });
    }
  }
  res.json({ saved: results.filter((r) => r.status === 'SAVED').length, errors: results.filter((r) => r.status === 'ERROR').length, results });
});

exports.deleteSalaryMaster = asyncHandler(async (req, res) => {
  const master = await SalaryMaster.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!master) throw new ApiError(404, 'Salary master not found');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  if (!allowed.includes(String(master.employeeId))) throw new ApiError(403, 'Salary master is outside your Office / Factory scope');
  if (master.locked && req.user.role !== 'SUPER_ADMIN') throw new ApiError(403, 'This salary master is locked. Only super admin can delete it.');
  await RuleAudit.create({ tenantId: req.tenantId, module: 'SALARY_MASTER', action: 'DELETE_SALARY_MASTER', targetId: String(master._id), before: master.toObject(), reason: req.body?.reason || 'Salary master deleted', changedBy: req.user._id });
  await master.deleteOne();
  res.json({ deleted: true });
});


exports.rules = asyncHandler(async (req, res) => {
  const rules = await PayrollRule.find({ tenantId: req.tenantId }).sort('-active');
  res.json({ rules });
});

exports.upsertRule = asyncHandler(async (req, res) => {
  const before = await PayrollRule.findOne({ tenantId: req.tenantId, active: true }).lean();
  const rule = await PayrollRule.findOneAndUpdate({ tenantId: req.tenantId, active: true }, { ...req.body, tenantId: req.tenantId, active: true }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await RuleAudit.create({ tenantId: req.tenantId, module: 'PAYROLL', action: 'SAVE_PAYROLL_RULE', before, after: rule.toObject(), reason: req.body.notes || req.body.changeReason || 'Manual payroll statutory/deduction rule change', changedBy: req.user._id });
  res.json({ rule });
});

/** When each month's payroll opens, so the page can say "opens on 1 December 2026". */
function withOpening(run, rule) {
  const plain = typeof run.toObject === 'function' ? run.toObject() : { ...run };
  plain.opensOn = monthOpensOn(plain.month);
  plain.open = !payrollLockOn(rule) || isMonthOpen(plain.month);
  return plain;
}

exports.runs = asyncHandler(async (req, res) => {
  const [runDocs, rule] = await Promise.all([
    PayrollRun.find({ tenantId: req.tenantId }).sort('-month'),
    PayrollRule.findOne({ tenantId: req.tenantId, active: true }).select('lockUntilMonthEnds').lean()
  ]);
  const runs = runDocs.map((run) => withOpening(run, rule));
  const lock = { on: payrollLockOn(rule), today: companyTodayKey() };
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)) return res.json({ runs, lock });
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  const scopedRuns = await Promise.all(runs.map(async (run) => {
    const slips = await SalarySlip.find({ tenantId: req.tenantId, payrollRunId: run._id, employeeId: { $in: allowed } }).select('earnings deductions netPay');
    run.summary = {
      employeeCount: slips.length,
      grossTotal: roundMoney(slips.reduce((sum, slip) => sum + Number(slip.earnings?.total ?? slip.earnings?.proratedGross ?? 0), 0)),
      deductionTotal: roundMoney(slips.reduce((sum, slip) => sum + Number(slip.deductions?.total || 0), 0)),
      netTotal: roundMoney(slips.reduce((sum, slip) => sum + Number(slip.netPay || 0), 0))
    };
    return run;
  }));
  res.json({ runs: scopedRuns, lock });
});

exports.runPayroll = asyncHandler(async (req, res) => {
  const { month } = req.body;
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new ApiError(400, 'month must be YYYY-MM');
  const rule = await PayrollRule.findOne({ tenantId: req.tenantId, active: true });
  if (!rule) throw new ApiError(400, 'Create a payroll rule first');
  // Company clock, not the server's (UTC): 1 December starts at midnight India time.
  const currentMonth = companyTodayKey().slice(0, 7);
  if (month > currentMonth) throw new ApiError(400, 'Payroll cannot be generated for a future month');
  // Payroll lock (on by default): a month's payroll opens on the 1st of the next month.
  const locked = lockedReason(rule, month);
  if (locked) throw new ApiError(400, locked, { code: 'PAYROLL_MONTH_LOCKED', opensOn: monthOpensOn(month) });

  // v26: re-running a month silently reset a RELEASED run to DRAFT and rewrote
  // slips employees had already received. Only Super Admin may regenerate a
  // released month, and only by confirming it explicitly.
  const existingRun = await PayrollRun.findOne({ tenantId: req.tenantId, month });
  if (existingRun?.status === 'FINALIZED') {
    if (req.user.role !== 'SUPER_ADMIN' || req.body.force !== true) {
      throw new ApiError(409, `Payroll for ${month} is already released. Super Admin can regenerate it by confirming "force".`);
    }
    if (!String(req.body.reason || '').trim()) throw new ApiError(400, 'A reason is required to regenerate a released payroll month');
  }

  // People who joined after the month ended have no payable days in it; they
  // used to receive a slip with net pay of -₹200 (professional tax on nothing).
  const { to: monthEnd } = monthRange(month);
  const employees = (await Employee.find({ tenantId: req.tenantId, status: { $ne: 'OFFBOARDED' } }))
    .filter((e) => !e.dateOfJoining || new Date(e.dateOfJoining) <= monthEnd);
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  if (employees.some((item) => !allowed.includes(String(item._id)))) {
    throw new ApiError(403, 'Running merged company payroll requires salary access to both Office and Factory. Expand the Salary scope or ask Super Admin.');
  }

  // Re-evaluate all existing attendance records first so latest policy, permissions,
  // worked duration and LOP overrides are reflected automatically in payroll.
  await evaluateMonth({
    tenantId: req.tenantId,
    employeeIds: employees.map((e) => e._id),
    month
  });

  const run = await PayrollRun.findOneAndUpdate(
    { tenantId: req.tenantId, month },
    { tenantId: req.tenantId, month, generatedBy: req.user._id, status: 'DRAFT' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (existingRun?.status === 'FINALIZED') {
    await RuleAudit.create({ tenantId: req.tenantId, module: 'PAYROLL', action: 'REGENERATE_RELEASED_PAYROLL', targetId: String(run._id), before: existingRun.toObject(), reason: String(req.body.reason).trim(), changedBy: req.user._id });
  }
  // Manual adjustments made on the previous draft are kept and re-applied below;
  // re-generating used to drop them from net pay while still showing them on the slip.
  const previousSlips = await SalarySlip.find({ tenantId: req.tenantId, month }).select('employeeId manualAdjustments edits netPay').lean();
  const previousByEmployee = new Map(previousSlips.map((slip) => [String(slip.employeeId), slip]));
  let grossTotal = 0;
  let deductionTotal = 0;
  let netTotal = 0;
  const slips = [];
  const salaryMasterMap = await getActiveSalaryMastersMap({ tenantId: req.tenantId, employeeIds: employees.map((e) => e._id), month });
  for (const employee of employees) {
    const { slip, netPay, gross, deductionTotal: slipDeductions } = await buildSlip({
      tenantId: req.tenantId,
      run,
      employee,
      month,
      rule,
      salaryMaster: salaryMasterMap.get(String(employee._id)),
      previous: previousByEmployee.get(String(employee._id)) || null
    });
    grossTotal += gross;
    deductionTotal += slipDeductions;
    netTotal += netPay;
    slips.push(slip);
  }
  run.summary = { employeeCount: employees.length, grossTotal: roundMoney(grossTotal), deductionTotal: roundMoney(deductionTotal), netTotal: roundMoney(netTotal) };
  await run.save();
  notifyLater({
    tenantId: req.tenantId,
    event: 'PAYROLL_GENERATED',
    recipients: await recipientsForRoles(req.tenantId, ['SUPER_ADMIN', 'HR_ADMIN']),
    path: '/payroll',
    entityId: `${run._id}:${Date.now()}`,
    actorUserId: req.user._id,
    data: { month, count: employees.length, totalNet: `₹${roundMoney(netTotal).toLocaleString('en-IN')}`, by: req.user.name },
    inApp: { type: 'PAYROLL_GENERATED', title: `Payroll generated for ${month}`, body: `${employees.length} employees processed. Net payroll: ₹${roundMoney(netTotal).toLocaleString('en-IN')}. Review the draft before sharing slips.`, entityType: 'PAYROLL_RUN', priority: 'HIGH' }
  });
  res.status(201).json({ run, slips, message: `Payroll for ${month} generated and attendance was recalculated first` });
});

exports.releaseRun = asyncHandler(async (req, res) => {
  const run = await PayrollRun.findOne({ _id: req.params.runId, tenantId: req.tenantId });
  if (!run) throw new ApiError(404, 'Payroll run not found');
  if (run.status === 'FINALIZED') return res.json({ run, message: `Payroll for ${run.month} is already released` });
  // A draft made before the lock existed (or while it was off) still waits for the month to end.
  const rule = await PayrollRule.findOne({ tenantId: req.tenantId, active: true }).select('lockUntilMonthEnds').lean();
  const locked = lockedReason(rule, run.month);
  if (locked) throw new ApiError(400, locked, { code: 'PAYROLL_MONTH_LOCKED', opensOn: monthOpensOn(run.month) });

  const before = run.toObject();
  run.status = 'FINALIZED';
  run.releasedAt = new Date();
  run.releasedBy = req.user._id;
  await run.save();
  await RuleAudit.create({
    tenantId: req.tenantId,
    module: 'PAYROLL',
    action: 'RELEASE_PAYROLL',
    targetId: String(run._id),
    before,
    after: run.toObject(),
    reason: req.body?.reason || `Payroll ${run.month} released`,
    changedBy: req.user._id
  });

  // Releasing does not message anyone. Payslips can still be corrected after
  // release; employees hear about their payslip only when HR sends it
  // (Send payslips), and only the people HR picks.
  res.json({ run, message: `Payroll for ${run.month} released. No one was notified; send payslips when they are ready.` });
});

/**
 * DELETE /api/payroll/runs/:runId — removes a payroll month and all its salary
 * slips (a test run, or one made too early). Attendance, salary masters and
 * loans are not touched; the month can be generated again later. A released
 * month can only be deleted by Super Admin, with a reason. Every delete is
 * recorded in the audit log with the totals that were removed.
 */
exports.deleteRun = asyncHandler(async (req, res) => {
  const run = await PayrollRun.findOne({ _id: req.params.runId, tenantId: req.tenantId });
  if (!run) throw new ApiError(404, 'Payroll run not found');
  const reason = String(req.body?.reason || '').trim();
  if (run.status === 'FINALIZED') {
    if (req.user.role !== 'SUPER_ADMIN') throw new ApiError(409, `Payroll for ${monthName(run.month)} is released. Only Super Admin can delete a released month.`);
    if (!reason) throw new ApiError(400, 'Type a reason to delete a released payroll month');
  }
  const slips = await SalarySlip.find({ tenantId: req.tenantId, payrollRunId: run._id }).select('employeeId netPay lastSharedAt').lean();
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  if (slips.some((slip) => !allowed.includes(String(slip.employeeId)))) {
    throw new ApiError(403, 'Deleting a payroll month needs salary access to everyone in it (Office and Factory).');
  }
  const removed = await SalarySlip.deleteMany({ tenantId: req.tenantId, payrollRunId: run._id });
  await run.deleteOne();
  await RuleAudit.create({
    tenantId: req.tenantId,
    module: 'PAYROLL',
    action: run.status === 'FINALIZED' ? 'DELETE_RELEASED_PAYROLL' : 'DELETE_PAYROLL_DRAFT',
    targetId: String(run._id),
    before: {
      run: run.toObject(),
      slips: slips.length,
      netTotal: roundMoney(slips.reduce((sum, slip) => sum + Number(slip.netPay || 0), 0)),
      sentToEmployees: slips.filter((slip) => slip.lastSharedAt).length
    },
    after: { deleted: true, slipsRemoved: removed.deletedCount || 0 },
    reason: reason || `Payroll ${run.month} draft deleted`,
    changedBy: req.user._id
  });
  res.json({ deleted: true, month: run.month, slipsRemoved: removed.deletedCount || 0, message: `${monthName(run.month)} payroll deleted with its ${removed.deletedCount || 0} salary slip(s). Attendance, salaries and loans are unchanged.` });
});

exports.slips = asyncHandler(async (req, res) => {
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  const q = { tenantId: req.tenantId, employeeId: { $in: allowed } };
  if (req.query.month) q.month = req.query.month;
  if (req.query.employeeId) {
    if (!allowed.includes(String(req.query.employeeId))) throw new ApiError(403, 'Salary slip is outside your scope');
    q.employeeId = req.query.employeeId;
  }
  // An employee must never see a slip from a run that is still being worked on.
  // Admins keep full visibility so they can review drafts before releasing.
  const isPayrollAdmin = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)
    || hasAbility(req.user, 'PAYROLL', 'RUN');
  let slips = await SalarySlip.find(q)
    .populate('employeeId', 'employeeCode firstName lastName department designation email phone salary')
    .populate('payrollRunId', 'month status releasedAt')
    .sort('-month');
  if (!isPayrollAdmin) {
    // Released only, and never for a month that has not ended while payroll is locked.
    const rule = await PayrollRule.findOne({ tenantId: req.tenantId, active: true }).select('lockUntilMonthEnds').lean();
    slips = slips.filter((slip) => slip.payrollRunId?.status === 'FINALIZED' && (!payrollLockOn(rule) || isMonthOpen(slip.month)));
  }
  // Employees get the payslip as paid, with its note: not the calculation
  // behind HR's edits, who edited it, or the share-link token hash.
  if (!isPayrollStaff(req.user)) {
    slips = slips.map((slip) => {
      const plain = slip.toObject();
      const notes = plain.edits?.notes || '';
      for (const key of ['calculated', 'edits', 'manualAdjustments', 'shareTokenHash', 'shareTokenExpiresAt', 'sharedBy', 'contentChangedAt']) delete plain[key];
      return { ...plain, notes };
    });
  }
  res.json({ slips, releasedOnly: !isPayrollAdmin });
});

exports.salarySheet = asyncHandler(async (req, res) => {
  const { run, rows } = await salarySheetRows(req, req.params.runId);
  res.json({ month: run.month, summary: run.summary, rows });
});

exports.salarySheetCsv = asyncHandler(async (req, res) => {
  const { run, rows } = await salarySheetRows(req, req.params.runId);
  const headers = ['Employee Code', 'Name', 'Department', 'Designation', 'Working Days', 'Payable Days', 'LOP Days', 'Basic', 'HRA', 'Conveyance', 'Special Allowance', 'Other Earnings', 'Gross', 'PF', 'ESI', 'PTax', 'Loan', 'Other Deductions', 'Total Deductions', 'Net Pay'];
  const body = rows.map((r) => [r.employeeCode, r.name, r.department, r.designation, r.workingDays, r.payableDays, r.lopDays, r.basic, r.hra, r.conveyance, r.specialAllowance, r.otherEarnings, r.gross, r.pf, r.esi, r.ptax, r.loan, r.otherDeductions, r.totalDeductions, r.netPay].map(csvEscape).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=salary-sheet-${run.month}.csv`);
  res.send([headers.join(','), ...body].join('\n'));
});

/**
 * The salary statement as an Excel file: one row per person with the same
 * columns as the CSV, a title, and live totals (SUM formulas) at the bottom.
 */
exports.salarySheetXlsx = asyncHandler(async (req, res) => {
  const { run, rows } = await salarySheetRows(req, req.params.runId);
  const [tenant, rule] = await Promise.all([
    Tenant.findById(req.tenantId).select('name').lean(),
    PayrollRule.findOne({ tenantId: req.tenantId, active: true }).select('roundToRupee').lean()
  ]);
  const money = rule?.roundToRupee === false ? '#,##0.00' : '#,##0';
  const headers = ['Employee Code', 'Name', 'Department', 'Designation', 'Working Days', 'Payable Days', 'LOP Days', 'Basic', 'HRA', 'Conveyance', 'Special Allowance', 'Other Earnings', 'Gross', 'PF', 'ESI', 'PTax', 'Loan', 'Other Deductions', 'Total Deductions', 'Net Pay'];
  const sorted = [...rows].sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode), 'en', { numeric: true }));
  const status = run.status === 'FINALIZED'
    ? `Released${run.releasedAt ? ` on ${new Date(run.releasedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`
    : 'Draft (not released)';
  const headerRow = 3;
  const firstData = headerRow + 1;
  const lastData = headerRow + sorted.length;
  const body = sorted.map((r) => [r.employeeCode, r.name, r.department, r.designation, r.workingDays, r.payableDays, r.lopDays, r.basic, r.hra, r.conveyance, r.specialAllowance, r.otherEarnings, r.gross, r.pf, r.esi, r.ptax, r.loan, r.otherDeductions, r.totalDeductions, r.netPay]);
  const totals = headers.map((_, c) => {
    if (c === 0) return 'Total';
    if (c < 7) return null;
    const col = columnLetter(c);
    const value = roundMoney(body.reduce((sum, row) => sum + Number(row[c] || 0), 0));
    return sorted.length ? { v: value, f: `SUM(${col}${firstData + 1}:${col}${lastData + 1})`, z: money } : 0;
  });
  const sheetRows = [
    [`Salary statement · ${monthName(run.month)}`],
    [`${tenant?.name || ''}${tenant?.name ? ' · ' : ''}${status} · ${sorted.length} ${sorted.length === 1 ? 'person' : 'people'}`],
    [],
    headers,
    ...body,
    totals
  ];
  const numberFormat = {};
  for (let c = 7; c < headers.length; c += 1) numberFormat[c] = money;
  const buffer = xlsxBook([{
    name: 'Salary statement',
    rows: sheetRows,
    widths: [12, 26, 18, 20, 9, 9, 8, 11, 11, 11, 13, 12, 12, 10, 9, 9, 10, 12, 13, 12],
    merges: ['A1:H1', 'A2:H2'],
    filter: `A${headerRow + 1}:T${Math.max(lastData + 1, headerRow + 1)}`,
    numberFormat,
    formatFromRow: firstData
  }]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="salary-statement-${run.month}.xlsx"`);
  res.send(buffer);
});

exports.salarySheetPdf = asyncHandler(async (req, res) => {
  const { run, rows } = await salarySheetRows(req, req.params.runId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=salary-sheet-${run.month}.pdf`);
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  doc.pipe(res);
  doc.fontSize(16).text(`Salary Sheet - ${run.month}`, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(9).text(`Employees: ${run.summary?.employeeCount || rows.length}    Gross: Rs. ${run.summary?.grossTotal || 0}    Deductions: Rs. ${run.summary?.deductionTotal || 0}    Net: Rs. ${run.summary?.netTotal || 0}`);
  doc.moveDown(0.8);
  const cols = [30, 80, 165, 235, 285, 333, 377, 421, 465, 520, 563, 603, 643, 690, 745];
  const heads = ['Code', 'Name', 'Dept', 'Pay/Work', 'Basic', 'HRA', 'Conv', 'Spl', 'Gross', 'PF', 'ESI', 'PTax', 'Loan', 'Deduct', 'Net'];
  let y = doc.y;
  doc.fontSize(8).font('Helvetica-Bold');
  heads.forEach((h, i) => doc.text(h, cols[i], y, { width: i === 1 ? 82 : i === 2 ? 66 : 44 }));
  doc.font('Helvetica');
  y += 16;
  for (const r of rows) {
    if (y > 550) { doc.addPage(); y = 30; }
    const vals = [r.employeeCode, r.name, r.department, `${r.payableDays}/${r.workingDays}`, r.basic, r.hra, r.conveyance, r.specialAllowance, r.gross, r.pf, r.esi, r.ptax, r.loan, r.totalDeductions, r.netPay];
    vals.forEach((v, i) => doc.text(String(v ?? ''), cols[i], y, { width: i === 1 ? 82 : i === 2 ? 66 : 44 }));
    y += 15;
  }
  doc.end();
});

async function findScopedSlip(req, slipId) {
  const slip = await SalarySlip.findOne({ _id: slipId, tenantId: req.tenantId }).populate('employeeId').populate('payrollRunId');
  if (!slip) throw new ApiError(404, 'Salary slip not found');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  if (!allowed.includes(String(slip.employeeId._id))) throw new ApiError(403, 'Salary slip is outside your scope');
  return slip;
}

function isPayrollAdmin(user) {
  return ['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role) || hasAbility(user, 'PAYROLL', 'RUN');
}

/** Anyone who works on payroll (run, read, edit or send payslips), as opposed to an employee viewing their own. */
function isPayrollStaff(user) {
  return isPayrollAdmin(user) || ['READ', 'ADJUST', 'SHARE'].some((action) => hasAbility(user, 'PAYROLL', action));
}

exports.slipPdf = asyncHandler(async (req, res) => {
  const slip = await findScopedSlip(req, req.params.id);
  // v26: the slip list hid drafts from employees, but the PDF link still served them.
  if (!isPayrollAdmin(req.user) && slip.payrollRunId?.status !== 'FINALIZED') throw new ApiError(404, 'Salary slip not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', attachmentHeader(payslipFileName(slip.employeeId, slip.month)));
  await writePayslipPdfToStream({ tenantId: req.tenantId, slip, stream: res });
});

exports.publicSlipPdf = asyncHandler(async (req, res) => {
  const slip = await SalarySlip.findById(req.params.id).populate('employeeId').populate('payrollRunId');
  if (!slip || !req.query.token || !slip.shareTokenHash || slip.shareTokenExpiresAt < new Date()) throw new ApiError(404, 'Salary slip link expired or invalid');
  if (hashToken(req.query.token) !== slip.shareTokenHash) throw new ApiError(404, 'Salary slip link expired or invalid');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', attachmentHeader(payslipFileName(slip.employeeId, slip.month)));
  await writePayslipPdfToStream({ tenantId: slip.tenantId, slip, stream: res });
});

exports.template = asyncHandler(async (req, res) => {
  const { template } = await getActivePayslipTemplate(req.tenantId);
  res.json({ template });
});

exports.saveTemplate = asyncHandler(async (req, res) => {
  const before = await PayslipTemplate.findOne({ tenantId: req.tenantId, active: true }).lean();
  await PayslipTemplate.updateMany({ tenantId: req.tenantId }, { active: false });
  const template = await PayslipTemplate.create({ ...req.body, tenantId: req.tenantId, active: true });
  await RuleAudit.create({ tenantId: req.tenantId, module: 'PAYSLIP', action: 'SAVE_PAYSLIP_TEMPLATE', before, after: template.toObject(), reason: req.body.changeReason || 'Manual payslip PDF format change', changedBy: req.user._id });
  res.status(201).json({ template });
});

/** Saves a slip's paid figures from its calculation and HR's edits, with an audit entry and fresh run totals. */
async function savePaidSlip(req, slip, edits, action, reason) {
  const before = slip.toObject();
  const calculated = calculatedOf(slip);
  const paid = applySlipEdits(calculated, edits, null);
  slip.calculated = calculated;
  slip.edits = edits || undefined;
  slip.manualAdjustments = undefined;
  slip.earnings = paid.earnings;
  slip.deductions = paid.deductions;
  slip.netPay = paid.netPay;
  slip.contentChangedAt = new Date();
  slip.markModified('calculated');
  slip.markModified('edits');
  slip.markModified('earnings');
  slip.markModified('deductions');
  await slip.save();
  await RuleAudit.create({ tenantId: req.tenantId, module: 'PAYROLL', action, targetId: String(slip._id), before, after: slip.toObject(), reason: reason || '', changedBy: req.user._id });
  const run = await PayrollRun.findOne({ _id: slip.payrollRunId?._id || slip.payrollRunId, tenantId: req.tenantId });
  if (run) await recalculateRunSummary(run);
  return slip;
}

function payslipResponse(slip) {
  const payslip = payslipLines(slip);
  return {
    slipId: slip._id,
    month: slip.month,
    runStatus: slip.payrollRunId?.status || null,
    employee: slip.employeeId ? { _id: slip.employeeId._id, employeeCode: slip.employeeId.employeeCode, firstName: slip.employeeId.firstName, lastName: slip.employeeId.lastName, department: slip.employeeId.department, designation: slip.employeeId.designation } : null,
    netPay: slip.netPay,
    netPayInWords: rupeesInWords(slip.netPay),
    lastSharedAt: slip.lastSharedAt || null,
    sharedChannels: slip.sharedChannels || [],
    changedSinceSent: Boolean(slip.lastSharedAt && slip.contentChangedAt && slip.contentChangedAt > slip.lastSharedAt),
    payslip
  };
}

/** The payslip as an employee sees it: what is paid, without the calculation behind HR's edits. */
function employeePayslipView(response) {
  const p = response.payslip;
  const line = ({ ref, label, master, amount }) => ({ ref, label, master, amount });
  const extra = ({ id, label, amount }) => ({ id, label, amount });
  return {
    slipId: response.slipId,
    month: response.month,
    runStatus: response.runStatus,
    employee: response.employee,
    netPay: response.netPay,
    netPayInWords: response.netPayInWords,
    payslip: {
      earnings: p.earnings.map(line),
      deductions: p.deductions.map(line),
      extraEarnings: p.extraEarnings.map(extra),
      extraDeductions: p.extraDeductions.map(extra),
      totals: p.totals,
      info: { payableDays: p.info.payableDays, lopDays: p.info.lopDays, workingDays: p.info.workingDays },
      notes: p.notes
    }
  };
}

/** GET /payroll/slips/:id/payslip — the payslip line by line (editor and preview). */
exports.payslip = asyncHandler(async (req, res) => {
  const slip = await findScopedSlip(req, req.params.id);
  const canOpenDrafts = isPayrollAdmin(req.user) || hasAbility(req.user, 'PAYROLL', 'ADJUST');
  if (!canOpenDrafts && slip.payrollRunId?.status !== 'FINALIZED') throw new ApiError(404, 'Salary slip not found');
  const response = payslipResponse(slip);
  res.json(isPayrollStaff(req.user) ? response : employeePayslipView(response));
});

/**
 * PUT /payroll/slips/:id/payslip — HR edits a payslip directly: any line's
 * amount, extra lines (bonus, loan…), the work days / LOP shown and a note.
 * Works before and after release; nobody is notified (sending is separate).
 */
exports.editPayslip = asyncHandler(async (req, res) => {
  const slip = await findScopedSlip(req, req.params.id);
  let edits;
  try {
    edits = editsFromRequest(slip, req.body || {}, req.user);
  } catch (error) {
    throw new ApiError(400, error.message);
  }
  await savePaidSlip(req, slip, edits, 'SALARY_SLIP_EDIT', String(req.body?.reason || '').trim().slice(0, 300));
  const response = payslipResponse(slip);
  const who = `${slip.employeeId?.firstName || ''} ${slip.employeeId?.lastName || ''}`.trim();
  const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  res.json({ ...response, message: `${who}'s payslip saved. Net pay ${money(slip.netPay)}.${response.changedSinceSent ? ' It was already sent: send it again so they get the corrected one.' : ''}` });
});

/**
 * GET /payroll/runs/:runId/sheet — the month's payslips as one table for the
 * payroll sheet (Excel-like editing). ?employeeId= returns just that person's row
 * (after an attendance change from the sheet).
 */
exports.sheet = asyncHandler(async (req, res) => {
  const { sheetColumns, sheetRow } = require('../services/payrollSheetService');
  const run = await PayrollRun.findOne({ _id: req.params.runId, tenantId: req.tenantId });
  if (!run) throw new ApiError(404, 'Payroll run not found');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  const all = await SalarySlip.find({ tenantId: req.tenantId, payrollRunId: run._id, employeeId: { $in: allowed } })
    .populate('employeeId', 'employeeCode firstName lastName department designation workLocation');
  const columns = sheetColumns(all.map((s) => s.toObject()));
  let slips = all;
  if (req.query.employeeId) slips = all.filter((s) => String(s.employeeId?._id) === String(req.query.employeeId));
  const rows = slips.map((s) => sheetRow(s, columns)).sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode), 'en', { numeric: true }));
  res.json({
    run: { _id: run._id, month: run.month, status: run.status, releasedAt: run.releasedAt || null, summary: run.summary },
    canEdit: isPayrollAdmin(req.user) || hasAbility(req.user, 'PAYROLL', 'ADJUST'),
    canChangeAttendance: ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role) || hasAbility(req.user, 'ATTENDANCE', 'OVERRIDE'),
    columns,
    rows
  });
});

/**
 * PUT /payroll/runs/:runId/sheet {changes:[{slipId, version, set:{ref:amount}, revert:[ref], extra:{E,D}, notes}], reason}
 * — saves the sheet into the payslips (all or nothing). Works before and after release; nobody is notified.
 */
exports.saveSheet = asyncHandler(async (req, res) => {
  const { sheetColumns, sheetRow, saveSheetChanges } = require('../services/payrollSheetService');
  const run = await PayrollRun.findOne({ _id: req.params.runId, tenantId: req.tenantId });
  if (!run) throw new ApiError(404, 'Payroll run not found');
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
  const allowed = new Set((await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' })).map(String));
  const owners = await SalarySlip.find({ tenantId: req.tenantId, _id: { $in: changes.map((c) => String(c.slipId || '')) } }).select('employeeId').lean();
  if (owners.some((s) => !allowed.has(String(s.employeeId)))) throw new ApiError(403, 'Some of these payslips are outside your salary scope');
  const { saved, slips } = await saveSheetChanges(req, run, changes, req.body?.reason);
  const all = await SalarySlip.find({ tenantId: req.tenantId, payrollRunId: run._id }).select('calculated earnings deductions edits manualAdjustments').lean();
  const columns = sheetColumns(all);
  const rows = slips.map((s) => sheetRow(s, columns));
  const resend = rows.filter((r) => r.changedSinceSent).length;
  res.json({
    saved,
    rows,
    columns,
    summary: run.summary,
    message: `${saved} payslip${saved === 1 ? '' : 's'} saved.${resend ? ` ${resend} of them ${resend === 1 ? 'was' : 'were'} already sent: send ${resend === 1 ? 'it' : 'them'} again so they get the corrected payslip.` : ''}`
  });
});

/** DELETE /payroll/slips/:id/payslip — back to the calculated payslip. */
exports.resetPayslip = asyncHandler(async (req, res) => {
  const slip = await findScopedSlip(req, req.params.id);
  await savePaidSlip(req, slip, null, 'SALARY_SLIP_EDIT_RESET', 'Payslip reset to the calculated figures');
  res.json({ ...payslipResponse(slip), message: 'Payslip reset to the calculated figures.' });
});

/** Older "manual adjustment" call: now an extra earning / deduction line on the payslip. */
exports.adjustSlip = asyncHandler(async (req, res) => {
  const slip = await findScopedSlip(req, req.params.id);
  if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role) && !hasAbility(req.user, 'PAYROLL', 'ADJUST')) throw new ApiError(403, 'Only permitted users can adjust slips');
  const { earningsAdjustment = 0, deductionAdjustment = 0, reason = '' } = req.body;
  const current = payslipLines(slip);
  const extra = [...current.extraEarnings.map((l) => ({ ...l, side: 'E' })), ...current.extraDeductions.map((l) => ({ ...l, side: 'D' }))]
    .filter((l) => !['adjustment-e', 'adjustment-d'].includes(l.id));
  if (Number(earningsAdjustment)) extra.push({ id: 'adjustment-e', side: 'E', label: 'ADJUSTMENT', amount: Number(earningsAdjustment) });
  if (Number(deductionAdjustment)) extra.push({ id: 'adjustment-d', side: 'D', label: 'ADJUSTMENT', amount: Number(deductionAdjustment) });
  let edits;
  try {
    edits = editsFromRequest(slip, {
      lines: [...current.earnings, ...current.deductions].map((l) => ({ ref: l.ref, amount: l.amount })),
      extra,
      info: { payableDays: current.info.payableDays, lopDays: current.info.lopDays },
      notes: current.notes
    }, req.user);
  } catch (error) {
    throw new ApiError(400, error.message);
  }
  await savePaidSlip(req, slip, edits, 'SALARY_SLIP_MANUAL_ADJUSTMENT', reason);
  res.json({ slip });
});

exports.shareSlips = asyncHandler(async (req, res) => {
  const { month, employeeIds = [], salarySlipIds = [], channels = { email: true, whatsapp: true }, message = '' } = req.body;
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' });
  if (employeeIds.some((id) => !allowed.includes(String(id)))) throw new ApiError(403, 'One or more selected employees are outside your salary scope');
  const q = { tenantId: req.tenantId, employeeId: { $in: allowed } };
  if (salarySlipIds.length) q._id = { $in: salarySlipIds };
  if (employeeIds.length) q.employeeId = { $in: employeeIds };
  if (month) q.month = month;
  if (!salarySlipIds.length && !employeeIds.length) throw new ApiError(400, 'Select at least one employee or salary slip');
  // The whole employee record: the payslip prints joining date, bank, PAN, PF / UAN and location.
  const slips = await SalarySlip.find(q).populate('employeeId').populate('payrollRunId', 'month status');
  if (salarySlipIds.length && slips.length !== new Set(salarySlipIds.map(String)).size) throw new ApiError(403, 'One or more selected salary slips are outside your salary scope');
  // Employees cannot open a draft slip in the portal, so sharing one sends them a
  // link to something they cannot see yet. Release the month first (or confirm).
  const drafts = slips.filter((slip) => slip.payrollRunId?.status !== 'FINALIZED');
  if (drafts.length && req.body.allowDraft !== true) {
    throw new ApiError(409, `${drafts.length} selected slip(s) belong to a payroll month that is not released yet. Release payroll first, or confirm sharing the draft.`);
  }
  const results = [];
  for (const slip of slips) {
    const employee = slip.employeeId;
    const token = randomToken(24);
    slip.shareTokenHash = hashToken(token);
    slip.shareTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    slip.lastSharedAt = new Date();
    slip.sharedBy = req.user._id;
    slip.sharedChannels = [];
    const link = `${env.publicApiUrl}/api/payroll/public/slips/${slip._id}/pdf?token=${encodeURIComponent(token)}`;
    const pdf = await payslipPdfBuffer({ tenantId: req.tenantId, slip });
    const name = `${employee.firstName || ''} ${employee.lastName || ''}`.trim();
    if (channels.email !== false) slip.sharedChannels.push('EMAIL');
    if (channels.whatsapp !== false) slip.sharedChannels.push('WHATSAPP');
    await slip.save();
    // Queued, not sent inline: sharing 300 slips used to hold the request open
    // for minutes while each SMTP call finished. Status appears in Integrations → Delivery log.
    const logs = await notify({
      tenantId: req.tenantId,
      event: 'PAYSLIP_PUBLISHED',
      recipients: [{ employeeId: employee._id }],
      path: '/payroll',
      entityId: `${slip._id}:${slip.lastSharedAt.getTime()}`,
      actorUserId: req.user._id,
      channels: { email: channels.email !== false, whatsapp: channels.whatsapp !== false },
      data: { month: slip.month, employeeCode: employee.employeeCode, slipLink: link, attached: channels.email !== false, employeeName: name, note: message || '' },
      attachments: [{ filename: payslipFileName(employee, slip.month), contentType: 'application/pdf', contentBase64: pdf.toString('base64'), url: link }],
      inApp: { type: 'PAYSLIP_READY', title: `Salary slip ready · ${slip.month}`, body: `Your salary slip for ${slip.month} is ready. Open Payroll to view the details.`, link: '/payroll', entityType: 'SALARY_SLIP' }
    });
    results.push({ slipId: slip._id, employeeCode: employee.employeeCode, link, logs });
  }
  res.json({ shared: results.length, results: results.map((r) => ({ ...r, logs: (r.logs || []).map((l) => ({ channel: l?.channel, status: l?.status, error: l?.error })) })), message: `${results.length} salary slip(s) shared. Email and WhatsApp are being delivered in the background.` });
});

/**
 * Loans and salary advances recovered from salary (Payroll → Loans).
 * The instalment itself is put on the payslip by the payroll run, see
 * services/loanService.js.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Employee = require('../models/Employee');
const EmployeeLoan = require('../models/EmployeeLoan');
const PayrollRun = require('../models/PayrollRun');
const RuleAudit = require('../models/RuleAudit');
const { readWorkbookRows, workbookBuffer, parseImportDate, parseImportMonth } = require('../utils/excel');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { loanStatements } = require('../services/loanService');
const { refreshPayrollAfterAttendanceChange } = require('../services/payrollSlipService');
const { companyToday } = require('../utils/date');

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const isBlank = (v) => v === '' || v === null || v === undefined;
const first = (...values) => values.find((v) => !isBlank(v));
const text = (...values) => String(first(...values) ?? '').trim();

/** "₹55,000" / "55000" / 55000 → 55000; a blank cell → undefined; anything else → NaN. */
function rupees(value) {
  if (isBlank(value)) return undefined;
  if (typeof value === 'number') return round2(value);
  const cleaned = String(value).replace(/₹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
  return cleaned ? round2(Number(cleaned)) : undefined;
}

function thisMonth() {
  const d = companyToday();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function problemWith({ amount, emi, balanceAtStart, startMonth }) {
  if (!(amount > 0)) return 'Loan Amount must be more than 0';
  if (!(emi > 0)) return 'Monthly EMI must be more than 0';
  if (!(balanceAtStart >= 0)) return 'Balance To Recover must be 0 or more';
  if (balanceAtStart > amount) return 'Balance To Recover cannot be more than the Loan Amount';
  if (!/^\d{4}-\d{2}$/.test(startMonth || '')) return 'First EMI Month must be a month, like 2026-11';
  return null;
}

async function salaryScope(req) {
  return new Set((await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'SALARY' })).map(String));
}

/** Payroll drafts from `fromMonth` on are rebuilt for these people, so the payslip shows the loan at once. */
async function refreshDrafts(tenantId, employeeIds, fromMonth) {
  if (!employeeIds.length) return [];
  const runs = await PayrollRun.find({ tenantId, month: { $gte: fromMonth }, status: { $ne: 'FINALIZED' } }).select('month').lean();
  if (!runs.length) return [];
  const results = await refreshPayrollAfterAttendanceChange({ tenantId, employeeIds, months: runs.map((r) => r.month) });
  return results.filter((r) => r.state === 'UPDATED').map((r) => r.month);
}

exports.list = asyncHandler(async (req, res) => {
  const allowed = await salaryScope(req);
  const loans = await loanStatements({ tenantId: req.tenantId, employeeIds: [...allowed] });
  res.json({ loans, month: thisMonth() });
});

exports.save = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const allowed = await salaryScope(req);
  let loan = body._id ? await EmployeeLoan.findOne({ _id: body._id, tenantId: req.tenantId }) : null;
  if (body._id && !loan) throw new ApiError(404, 'Loan not found');
  const employeeId = loan ? loan.employeeId : body.employeeId;
  const employee = employeeId ? await Employee.findOne({ _id: employeeId, tenantId: req.tenantId }).select('employeeCode firstName lastName') : null;
  if (!employee || !allowed.has(String(employee._id))) throw new ApiError(404, 'Employee not found or outside your salary scope');
  const amount = rupees(body.amount);
  const values = {
    name: text(body.name) || 'Loan',
    amount,
    emi: rupees(body.emi),
    balanceAtStart: isBlank(body.balanceAtStart) ? amount : rupees(body.balanceAtStart),
    startMonth: text(body.startMonth),
    loanDate: body.loanDate ? new Date(body.loanDate) : undefined,
    notes: text(body.notes)
  };
  const problem = problemWith(values);
  if (problem) throw new ApiError(400, problem);
  const before = loan ? loan.toObject() : null;
  if (!loan) loan = new EmployeeLoan({ tenantId: req.tenantId, employeeId: employee._id, source: 'HRMS', createdBy: req.user._id });
  loan.set({ ...values, updatedBy: req.user._id });
  await loan.save();
  await RuleAudit.create({ tenantId: req.tenantId, module: 'PAYROLL', action: before ? 'LOAN_UPDATE' : 'LOAN_ADD', targetId: String(loan._id), before, after: loan.toObject(), reason: `${employee.employeeCode}: ${values.name}`, changedBy: req.user._id });
  const draftsUpdated = await refreshDrafts(req.tenantId, [String(employee._id)], [before?.startMonth, values.startMonth].filter(Boolean).sort()[0]);
  res.json({ loan, draftsUpdated });
});

/** Close a loan (no instalment from this month on), or open it again with { reopen: true }. */
exports.close = asyncHandler(async (req, res) => {
  const loan = await EmployeeLoan.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!loan) throw new ApiError(404, 'Loan not found');
  const allowed = await salaryScope(req);
  if (!allowed.has(String(loan.employeeId))) throw new ApiError(403, 'This loan is outside your salary scope');
  const before = loan.toObject();
  if (req.body?.reopen === true) {
    loan.status = 'ACTIVE';
    loan.closedMonth = undefined;
    loan.closedReason = undefined;
  } else {
    loan.status = 'CLOSED';
    loan.closedMonth = /^\d{4}-\d{2}$/.test(req.body?.month || '') ? req.body.month : thisMonth();
    loan.closedReason = text(req.body?.reason) || 'Closed by HR';
  }
  loan.updatedBy = req.user._id;
  await loan.save();
  await RuleAudit.create({ tenantId: req.tenantId, module: 'PAYROLL', action: req.body?.reopen === true ? 'LOAN_REOPEN' : 'LOAN_CLOSE', targetId: String(loan._id), before, after: loan.toObject(), reason: loan.closedReason || 'Loan opened again', changedBy: req.user._id });
  const from = [before.closedMonth, loan.closedMonth, thisMonth()].filter(Boolean).sort()[0];
  const draftsUpdated = await refreshDrafts(req.tenantId, [String(loan.employeeId)], from);
  res.json({ loan, draftsUpdated });
});

const HEADERS = ['Employee Code', 'Employee Name', 'Loan Name', 'Loan Amount', 'Monthly EMI', 'Balance To Recover', 'First EMI Month', 'Loan Date', 'Notes'];

exports.template = asyncHandler(async (req, res) => {
  const buffer = workbookBuffer({
    sheetName: 'Loans',
    headers: HEADERS,
    instructions: [
      'One row per loan. The Employee Code must already be in the HRMS; Employee Name is only for you to read.',
      'Loan Amount: the loan given. Monthly EMI: taken off the payslip every month (LOAN line); the last instalment is only what is left.',
      'Balance To Recover: what is still owed from the First EMI Month on. Leave it blank for a new loan (the whole Loan Amount).',
      'First EMI Month: the first payslip with an instalment, for example 2026-11.',
      'Loan Date (optional): when the loan was given, DD/MM/YYYY.',
      'Uploading the same file again updates those loans instead of adding them twice (same person, Loan Name, Loan Amount and First EMI Month).'
    ]
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="JPK-Loans-Import-Template.xlsx"');
  res.end(buffer);
});

exports.importExcel = asyncHandler(async (req, res) => {
  const rows = readWorkbookRows(req.body.dataUrl, { raw: true });
  const date1904 = rows.date1904;
  const allowed = await salaryScope(req);
  const source = /greythr/i.test(String(req.body.fileName || '')) ? 'GREYTHR' : 'EXCEL';
  const result = { created: 0, updated: 0, errors: [], warnings: [] };
  const touched = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNo = index + 2;
    if (Object.values(row).every(isBlank)) continue;
    const typed = text(row['Employee Code'], row.employeeCode);
    const code = typed.toUpperCase();
    if (!code) { result.errors.push({ row: rowNo, message: 'Employee Code is empty' }); continue; }
    const employee = await Employee.findOne({ tenantId: req.tenantId, employeeCode: { $in: [typed, code] } }).select('employeeCode firstName lastName status');
    if (!employee || !allowed.has(String(employee._id))) { result.errors.push({ row: rowNo, employeeCode: code, message: 'Not in the HRMS (or outside your salary scope). Import the employee first.' }); continue; }
    const amount = rupees(row['Loan Amount']);
    const startMonth = parseImportMonth(first(row['First EMI Month'], row['Start Month']), { date1904 });
    const loanDate = parseImportDate(row['Loan Date'], { date1904 });
    const values = {
      name: text(row['Loan Name']) || 'Loan',
      amount,
      emi: rupees(row['Monthly EMI']),
      balanceAtStart: isBlank(row['Balance To Recover']) ? amount : rupees(row['Balance To Recover']),
      startMonth,
      notes: text(row.Notes, row['Note'])
    };
    const problem = problemWith(values);
    if (problem) { result.errors.push({ row: rowNo, employeeCode: code, message: problem }); continue; }
    if (loanDate === null) result.warnings.push({ row: rowNo, employeeCode: code, message: `Loan Date "${row['Loan Date']}" is not a date, so it was left empty` });
    if (loanDate) values.loanDate = loanDate;
    if (values.balanceAtStart === 0) { result.warnings.push({ row: rowNo, employeeCode: code, message: 'Nothing left to recover, so this loan was not added' }); continue; }
    const same = { tenantId: req.tenantId, employeeId: employee._id, name: values.name, amount: values.amount, startMonth: values.startMonth };
    const existing = await EmployeeLoan.findOne(same);
    const others = await EmployeeLoan.countDocuments({ tenantId: req.tenantId, employeeId: employee._id, status: 'ACTIVE', ...(existing ? { _id: { $ne: existing._id } } : {}) });
    if (others) result.warnings.push({ row: rowNo, employeeCode: code, message: `Also has ${others} other running loan${others === 1 ? '' : 's'}: every instalment comes off the payslip` });
    if (existing) {
      existing.set({ ...values, updatedBy: req.user._id });
      await existing.save();
      result.updated += 1;
    } else {
      await EmployeeLoan.create({ ...same, ...values, source, createdBy: req.user._id, updatedBy: req.user._id });
      result.created += 1;
    }
    const id = String(employee._id);
    if (!touched.has(id) || values.startMonth < touched.get(id)) touched.set(id, values.startMonth);
  }
  if (result.created || result.updated) {
    await RuleAudit.create({ tenantId: req.tenantId, module: 'PAYROLL', action: 'LOAN_IMPORT', after: { created: result.created, updated: result.updated, errors: result.errors.length }, reason: `Loans from Excel ${req.body.fileName || ''}`.trim(), changedBy: req.user._id });
  }
  const firstMonth = [...touched.values()].sort()[0];
  result.draftsUpdated = firstMonth ? await refreshDrafts(req.tenantId, [...touched.keys()], firstMonth) : [];
  res.json(result);
});

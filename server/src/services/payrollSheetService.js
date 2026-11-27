/**
 * The payroll sheet: a month's payslips as one Excel-like table that HR edits
 * in place (Payroll → Payroll sheet).
 *
 * Every amount cell is a payslip line. Saving pins the changed lines on each
 * payslip exactly like the payslip editor does (services/payslipModel.js), so
 * the payslip, its PDF, the salary sheet and the run totals all show the new
 * figures, and a later recalculation of a draft keeps HR's amounts. Setting a
 * cell back to the calculated amount removes the pin.
 *
 * LOP is not typed here: it comes from attendance. The sheet opens the person's
 * month to mark days present / half day / absent (attendance day actions), and
 * the payroll draft follows.
 */
const SalarySlip = require('../models/SalarySlip');
const ApiError = require('../utils/apiError');
const RuleAudit = require('../models/RuleAudit');
const { applySlipEdits, calculatedOf, payslipLines } = require('./payslipModel');
const { recalculateRunSummary } = require('./payrollSlipService');

const STANDARD = [
  { ref: 'E:basic', label: 'BASIC' },
  { ref: 'E:hra', label: 'HRA' },
  { ref: 'E:conveyance', label: 'CONV.' },
  { ref: 'E:specialAllowance', label: 'SPL. ALLOWANCE' },
  { ref: 'E:otherEarnings', label: 'OTHER ALLOWANCE' },
  { ref: 'D:pf', label: 'PF' },
  { ref: 'D:esi', label: 'ESIC' },
  { ref: 'D:ptax', label: 'PROF TAX' },
  { ref: 'D:loan', label: 'LOAN' }
];

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const same = (a, b) => Math.abs(num(a) - num(b)) < 0.005;

function lineValue(ref, earnings = {}, deductions = {}) {
  const side = ref.slice(0, 1);
  const key = ref.slice(2);
  const bag = side === 'E' ? earnings : deductions;
  if (key.startsWith('custom:')) return num(bag.custom?.[key.slice(7)]);
  return num(bag[key]);
}

/** What is paid on a slip (calculated + HR's edits), for old and new slips alike. */
function paidOf(slip) {
  if (slip?.calculated?.earnings) return { earnings: slip.earnings || {}, deductions: slip.deductions || {}, netPay: num(slip.netPay) };
  return applySlipEdits(calculatedOf(slip), slip?.edits || null, slip?.manualAdjustments || null);
}

function customLabel(side, name) {
  if (side === 'D' && name === 'Other') return 'OTHER DEDUCTION';
  return String(name).toUpperCase();
}

/** The columns for a month: the standard lines, then any custom line some payslip has. */
function sheetColumns(slips) {
  const customE = new Set();
  const customD = new Set();
  for (const slip of slips) {
    const calc = calculatedOf(slip);
    const paid = paidOf(slip);
    for (const name of [...Object.keys(calc.earnings?.custom || {}), ...Object.keys(paid.earnings?.custom || {})]) customE.add(name);
    for (const name of [...Object.keys(calc.deductions?.custom || {}), ...Object.keys(paid.deductions?.custom || {})]) customD.add(name);
  }
  const byName = (a, b) => (a === 'Other' ? -1 : b === 'Other' ? 1 : a.localeCompare(b));
  return {
    earnings: [
      ...STANDARD.filter((c) => c.ref.startsWith('E:')),
      ...[...customE].sort(byName).map((name) => ({ ref: `E:custom:${name}`, label: customLabel('E', name) }))
    ],
    deductions: [
      ...STANDARD.filter((c) => c.ref.startsWith('D:')),
      ...[...customD].sort(byName).map((name) => ({ ref: `D:custom:${name}`, label: customLabel('D', name) }))
    ]
  };
}

function sheetRow(slip, columns) {
  const calc = calculatedOf(slip);
  const paid = paidOf(slip);
  const pinned = slip.edits?.lines || {};
  const lines = {};
  for (const col of [...columns.earnings, ...columns.deductions]) {
    lines[col.ref] = {
      amount: lineValue(col.ref, paid.earnings, paid.deductions),
      calculated: lineValue(col.ref, calc.earnings, calc.deductions),
      edited: pinned[col.ref] !== undefined
    };
  }
  const extraE = Array.isArray(paid.earnings?.extra) ? paid.earnings.extra : [];
  const extraD = Array.isArray(paid.deductions?.extra) ? paid.deductions.extra : [];
  const view = payslipLines(slip);
  const e = slip.employeeId || {};
  return {
    slipId: String(slip._id),
    version: slip.updatedAt ? new Date(slip.updatedAt).toISOString() : '',
    employeeId: String(e._id || slip.employeeId || ''),
    employeeCode: e.employeeCode || '',
    name: `${e.firstName || ''} ${e.lastName || ''}`.trim(),
    department: e.department || '',
    designation: e.designation || '',
    workLocation: e.workLocation || '',
    days: {
      working: view.info.workingDays,
      payable: view.info.payableDays,
      lop: view.info.lopDays,
      calculatedLop: view.info.calculatedLopDays,
      lopShownAsEdited: view.info.editedDays,
      review: num(slip.attendanceStats?.reviewDays)
    },
    lines,
    extra: {
      E: { amount: round2(extraE.reduce((t, l) => t + num(l.amount), 0)), count: extraE.length, labels: extraE.map((l) => l.label) },
      D: { amount: round2(extraD.reduce((t, l) => t + num(l.amount), 0)), count: extraD.length, labels: extraD.map((l) => l.label) }
    },
    notes: slip.edits?.notes || '',
    totals: { earnings: round2(num(paid.earnings?.total)), deductions: round2(num(paid.deductions?.total)), net: round2(num(paid.netPay)) },
    sent: Boolean(slip.lastSharedAt),
    changedSinceSent: Boolean(slip.lastSharedAt && slip.contentChangedAt && slip.contentChangedAt > slip.lastSharedAt)
  };
}

/** The new edits for one slip from a sheet change; throws a plain message for bad input. */
function sheetEdits(slip, change, user, allowedRefs, labels) {
  const calc = calculatedOf(slip);
  const prev = slip.edits ? JSON.parse(JSON.stringify(slip.edits)) : null;
  const lines = { ...(prev?.lines || {}) };
  const amountOf = (raw, label) => {
    const text = String(raw ?? '').replace(/[₹,\s]/g, '');
    const amount = text === '' ? 0 : Number(text);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e8) throw new Error(`${label}: enter an amount of 0 or more`);
    return round2(amount);
  };
  for (const [ref, raw] of Object.entries(change.set || {})) {
    if (!allowedRefs.has(ref)) throw new Error(`${ref}: not a payslip line`);
    const amount = amountOf(raw, labels.get(ref) || ref);
    if (same(amount, lineValue(ref, calc.earnings, calc.deductions))) delete lines[ref];
    else lines[ref] = amount;
  }
  for (const ref of Array.isArray(change.revert) ? change.revert : []) delete lines[ref];

  // Older "manual adjustment" amounts become their ADJUSTMENT lines the first time the slip is edited.
  let extra = prev ? (Array.isArray(prev.extra) ? prev.extra.slice() : []) : [
    ...(paidOf(slip).earnings?.extra || []).map((l) => ({ ...l, side: 'E' })),
    ...(paidOf(slip).deductions?.extra || []).map((l) => ({ ...l, side: 'D' }))
  ];
  for (const side of ['E', 'D']) {
    if (!change.extra || !Object.prototype.hasOwnProperty.call(change.extra, side)) continue;
    const mine = extra.filter((l) => l.side === side);
    if (mine.length > 1) throw new Error(`${side === 'E' ? 'Added earning' : 'Added deduction'}: this payslip has ${mine.length} added lines; open the payslip to change them`);
    const amount = amountOf(change.extra[side], side === 'E' ? 'Added earning' : 'Added deduction');
    if (!amount) extra = extra.filter((l) => l.side !== side);
    else if (mine.length) extra = extra.map((l) => (l.side === side ? { ...l, amount } : l));
    else extra.push({ id: `sheet-${side.toLowerCase()}`, side, label: 'ADJUSTMENT', amount });
  }
  const notes = change.notes !== undefined && change.notes !== null ? String(change.notes).trim().replace(/\s+\n/g, '\n').slice(0, 600) : (prev?.notes || '');
  const info = prev?.info && Object.keys(prev.info).length ? prev.info : undefined;
  const edits = { lines, extra, notes, updatedAt: new Date(), updatedBy: user._id, updatedByName: user.name || '' };
  if (info) edits.info = info;
  return !Object.keys(lines).length && !extra.length && !notes && !info ? null : edits;
}

/**
 * Saves the sheet's changes for one payroll run, all or nothing: every change
 * is checked first (amounts, lines, and that nobody changed the payslip since
 * the sheet was loaded), then each payslip is saved with an audit entry and
 * the run totals are worked out once.
 */
async function saveSheetChanges(req, run, changes = [], reason = '') {
  if (!Array.isArray(changes) || !changes.length) return { saved: 0, slips: [] };
  if (changes.length > 1000) throw new ApiError(400, 'Save at most 1,000 payslips at a time');
  const ids = changes.map((c) => String(c.slipId || ''));
  const slips = await SalarySlip.find({ tenantId: req.tenantId, payrollRunId: run._id, _id: { $in: ids } }).populate('employeeId', 'employeeCode firstName lastName department designation workLocation');
  const byId = new Map(slips.map((s) => [String(s._id), s]));
  const all = await SalarySlip.find({ tenantId: req.tenantId, payrollRunId: run._id }).select('calculated earnings deductions edits manualAdjustments').lean();
  const columns = sheetColumns(all);
  const labels = new Map([...columns.earnings, ...columns.deductions].map((c) => [c.ref, c.label]));
  const allowedRefs = new Set(labels.keys());
  const problems = [];
  const planned = [];
  for (const change of changes) {
    const slip = byId.get(String(change.slipId));
    if (!slip) { problems.push('A payslip in the sheet is no longer in this month. Reload the sheet.'); continue; }
    const who = `${slip.employeeId?.employeeCode || ''} ${slip.employeeId?.firstName || ''}`.trim();
    if (change.version && slip.updatedAt && new Date(change.version).getTime() !== new Date(slip.updatedAt).getTime()) {
      problems.push(`${who}: the payslip changed after you opened the sheet (for example an attendance change). Reload the sheet and enter it again.`);
      continue;
    }
    try {
      planned.push({ slip, edits: sheetEdits(slip, change, req.user, allowedRefs, labels) });
    } catch (error) {
      problems.push(`${who}: ${error.message}`);
    }
  }
  if (problems.length) {
    throw new ApiError(problems.some((p) => /changed after you opened/.test(p)) ? 409 : 400, problems.slice(0, 5).join(' · ') + (problems.length > 5 ? ` · and ${problems.length - 5} more` : ''), { problems });
  }
  const audits = [];
  const why = String(reason || '').trim().slice(0, 300) || 'Edited in the payroll sheet';
  for (const { slip, edits } of planned) {
    const before = { edits: slip.edits || null, netPay: slip.netPay };
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
    audits.push({ tenantId: req.tenantId, module: 'PAYROLL', action: 'SALARY_SLIP_SHEET_EDIT', targetId: String(slip._id), before, after: { edits: slip.edits || null, netPay: slip.netPay }, reason: why, changedBy: req.user._id });
  }
  if (audits.length) await RuleAudit.insertMany(audits);
  await recalculateRunSummary(run);
  return { saved: planned.length, slips: planned.map((p) => p.slip) };
}

module.exports = { sheetColumns, sheetRow, sheetEdits, saveSheetChanges, paidOf, lineValue };

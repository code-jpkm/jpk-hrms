/**
 * What a payslip says, line by line — shared by the PDF, the payslip editor,
 * the salary sheet and the payroll engine.
 *
 * A slip keeps two versions:
 *   slip.calculated  what the payroll engine worked out (attendance, LOP, PF / ESI / PT)
 *   slip.earnings / slip.deductions / slip.netPay
 *                    what is paid: the calculated values with HR's edits on top
 *
 * HR's edits (slip.edits) pin only the lines they changed, plus extra lines
 * (bonus, arrears, loan…), a note printed on the payslip, and the work days /
 * LOP shown on it. When a draft month is recalculated the pinned lines stay as
 * HR set them and every other line follows the new calculation.
 */

const COMPONENTS = ['basic', 'hra', 'conveyance', 'specialAllowance', 'otherEarnings'];

// Labels as on JPK's own payslip.
const EARNING_LINES = [
  { key: 'basic', label: 'BASIC' },
  { key: 'hra', label: 'HRA' },
  { key: 'conveyance', label: 'CONV.' },
  { key: 'specialAllowance', label: 'SPL. ALLOWANCE' },
  { key: 'otherEarnings', label: 'OTHER ALLOWANCE', onlyIfUsed: true }
];
const DEDUCTION_LINES = [
  { key: 'pf', label: 'PF' },
  { key: 'esi', label: 'ESIC' },
  { key: 'ptax', label: 'PROF TAX' },
  { key: 'loan', label: 'LOAN' }
];

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const same = (a, b) => Math.abs(num(a) - num(b)) < 0.005;
const clone = (v) => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
const sumValues = (obj) => round2(Object.values(obj || {}).reduce((t, v) => t + num(v), 0));

/** Line key → its amount in an earnings / deductions pair. */
function lineValue(side, key, earnings = {}, deductions = {}) {
  if (side === 'E') {
    if (key.startsWith('custom:')) return num(earnings.custom?.[key.slice(7)]);
    return num(earnings[key]);
  }
  if (key.startsWith('custom:')) return num(deductions.custom?.[key.slice(7)]);
  return num(deductions[key]);
}

function setLineValue(side, key, value, earnings, deductions) {
  if (side === 'E') {
    if (key.startsWith('custom:')) earnings.custom = { ...(earnings.custom || {}), [key.slice(7)]: round2(value) };
    else earnings[key] = round2(value);
    return;
  }
  if (key.startsWith('custom:')) deductions.custom = { ...(deductions.custom || {}), [key.slice(7)]: round2(value) };
  else deductions[key] = round2(value);
}

/** Totals from the lines, so every view of a slip foots the same way. */
function retotal(earnings, deductions) {
  earnings.proratedGross = round2(COMPONENTS.reduce((t, k) => t + num(earnings[k]), 0));
  const customEarnings = sumValues(earnings.custom);
  const extraEarnings = round2((earnings.extra || []).reduce((t, l) => t + num(l.amount), 0));
  earnings.total = round2(earnings.proratedGross + customEarnings + extraEarnings);
  deductions.otherDeductions = sumValues(deductions.custom);
  const extraDeductions = round2((deductions.extra || []).reduce((t, l) => t + num(l.amount), 0));
  deductions.total = round2(num(deductions.pf) + num(deductions.esi) + num(deductions.ptax) + num(deductions.loan) + deductions.otherDeductions + extraDeductions);
  return round2(earnings.total - deductions.total);
}

/**
 * The paid version of a slip: calculated values + HR edits (+ the older
 * "manual adjustment" amounts, shown as extra lines).
 */
function applySlipEdits(calculated, edits, manualAdjustments) {
  const earnings = clone(calculated?.earnings || {});
  const deductions = clone(calculated?.deductions || {});
  earnings.custom = { ...(earnings.custom || {}) };
  deductions.custom = { ...(deductions.custom || {}) };
  for (const [ref, value] of Object.entries(edits?.lines || {})) {
    const side = ref.slice(0, 1);
    const key = ref.slice(2);
    if (!['E', 'D'].includes(side) || !key) continue;
    setLineValue(side, key, value, earnings, deductions);
  }
  const extras = Array.isArray(edits?.extra) ? edits.extra : [];
  earnings.extra = extras.filter((l) => l.side === 'E').map((l) => ({ id: l.id, label: l.label, amount: round2(l.amount) }));
  deductions.extra = extras.filter((l) => l.side === 'D').map((l) => ({ id: l.id, label: l.label, amount: round2(l.amount) }));
  if (!edits) {
    const earningAdj = num(manualAdjustments?.earningsAdjustment ?? manualAdjustments?.earning);
    const deductionAdj = num(manualAdjustments?.deductionAdjustment ?? manualAdjustments?.deduction);
    if (earningAdj) earnings.extra.push({ id: 'adjustment-e', label: 'ADJUSTMENT', amount: round2(earningAdj) });
    if (deductionAdj) deductions.extra.push({ id: 'adjustment-d', label: 'ADJUSTMENT', amount: round2(deductionAdj) });
  }
  const netPay = retotal(earnings, deductions);
  return { earnings, deductions, netPay };
}

/**
 * The engine's figures as the "calculated" half of a slip. `loan` is this
 * month's loan instalment (services/loanService.js) and `loans` which loan each
 * part of it recovers.
 */
function calculatedFromEngine(calc, { loan = 0, loans = [] } = {}) {
  const earnings = {
    basic: calc.basic,
    hra: calc.hra,
    conveyance: calc.conveyance,
    specialAllowance: calc.specialAllowance,
    otherEarnings: calc.otherEarnings,
    gross: calc.gross,
    custom: { ...(calc.customEarnings || {}) },
    master: { ...(calc.contractEarnings || {}) }
  };
  const deductions = { ...clone(calc.deductions || {}), loan: round2(loan) };
  const netPay = retotal(earnings, deductions);
  return loans.length ? { earnings, deductions, netPay, loans: clone(loans) } : { earnings, deductions, netPay };
}

/** Older slips have no "calculated" copy: their saved figures are the calculation. */
function calculatedOf(slip) {
  if (slip?.calculated?.earnings) return slip.calculated;
  const earnings = clone(slip?.earnings || {});
  const deductions = clone(slip?.deductions || {});
  delete earnings.extra;
  delete deductions.extra;
  deductions.loan = num(deductions.loan);
  return { earnings, deductions, netPay: retotal(earnings, deductions) };
}

/** Monthly (full) salary per component: saved on new slips, worked back from the LOP trail on old ones. */
function masterOf(slip) {
  const saved = slip?.earnings?.master || slip?.calculated?.earnings?.master;
  if (saved && Object.keys(saved).length) return saved;
  const base = calculatedOf(slip).earnings;
  const master = {};
  for (const key of COMPONENTS) master[key] = num(base[key]);
  for (const step of slip?.lop?.breakdown || []) {
    if (COMPONENTS.includes(step.component)) master[step.component] = round2(master[step.component] + num(step.deducted));
  }
  return master;
}

/**
 * The payslip as lines: what the PDF prints and the editor shows.
 * Each standard line carries the calculated amount and whether HR changed it.
 */
function payslipLines(slip) {
  const calculated = calculatedOf(slip);
  // Slips saved before edits existed: their older "manual adjustment" only moved
  // net pay, so show it as extra lines and the totals still foot.
  const paid = slip?.calculated?.earnings
    ? { earnings: slip?.earnings || {}, deductions: slip?.deductions || {} }
    : applySlipEdits(calculated, slip?.edits || null, slip?.manualAdjustments || null);
  const master = masterOf(slip);
  const pinned = slip?.edits?.lines || {};

  const earnings = [];
  for (const def of EARNING_LINES) {
    const amount = lineValue('E', def.key, paid.earnings, paid.deductions);
    const m = num(master[def.key]);
    if (def.onlyIfUsed && !amount && !m && pinned[`E:${def.key}`] === undefined) continue;
    earnings.push({ ref: `E:${def.key}`, label: def.label, master: m, amount, calculated: lineValue('E', def.key, calculated.earnings, calculated.deductions), edited: pinned[`E:${def.key}`] !== undefined });
  }
  const customEarnings = new Set([...Object.keys(calculated.earnings.custom || {}), ...Object.keys(paid.earnings.custom || {})]);
  for (const name of customEarnings) {
    const key = `custom:${name}`;
    const amount = lineValue('E', key, paid.earnings);
    earnings.push({ ref: `E:${key}`, label: String(name).toUpperCase(), master: lineValue('E', key, calculated.earnings), amount, calculated: lineValue('E', key, calculated.earnings), edited: pinned[`E:${key}`] !== undefined });
  }

  const deductions = DEDUCTION_LINES.map((def) => ({
    ref: `D:${def.key}`,
    label: def.label,
    amount: lineValue('D', def.key, paid.earnings, paid.deductions),
    calculated: lineValue('D', def.key, calculated.earnings, calculated.deductions),
    edited: pinned[`D:${def.key}`] !== undefined
  }));
  const customDeductions = new Set([...Object.keys(calculated.deductions.custom || {}), ...Object.keys(paid.deductions.custom || {})]);
  for (const name of customDeductions) {
    const key = `custom:${name}`;
    deductions.push({ ref: `D:${key}`, label: name === 'Other' ? 'OTHER DEDUCTION' : String(name).toUpperCase(), amount: lineValue('D', key, paid.earnings, paid.deductions), calculated: lineValue('D', key, calculated.earnings, calculated.deductions), edited: pinned[`D:${key}`] !== undefined });
  }

  const extraEarnings = (paid.earnings.extra || []).map((l) => ({ id: l.id, label: l.label, amount: num(l.amount) }));
  const extraDeductions = (paid.deductions.extra || []).map((l) => ({ id: l.id, label: l.label, amount: num(l.amount) }));

  const stats = slip?.attendanceStats || {};
  const info = slip?.edits?.info || {};
  const lopDays = info.lopDays ?? num(stats.attendanceLopDays);
  const payableDays = info.payableDays ?? num(stats.payableDays);

  const totals = {
    master: round2(earnings.reduce((t, l) => t + num(l.master), 0)),
    earnings: round2(earnings.reduce((t, l) => t + num(l.amount), 0) + extraEarnings.reduce((t, l) => t + l.amount, 0)),
    deductions: round2(deductions.reduce((t, l) => t + num(l.amount), 0) + extraDeductions.reduce((t, l) => t + l.amount, 0))
  };
  totals.net = round2(totals.earnings - totals.deductions);

  return {
    earnings,
    deductions,
    extraEarnings,
    extraDeductions,
    totals,
    calculatedNet: calculated.netPay,
    info: { payableDays, lopDays, workingDays: num(stats.workingDays), calculatedPayableDays: num(stats.payableDays), calculatedLopDays: num(stats.attendanceLopDays), editedDays: info.payableDays !== undefined || info.lopDays !== undefined },
    notes: slip?.edits?.notes || '',
    edited: Boolean(slip?.edits && (Object.keys(slip.edits.lines || {}).length || (slip.edits.extra || []).length || slip.edits.notes || info.payableDays !== undefined || info.lopDays !== undefined)),
    editedAt: slip?.edits?.updatedAt || null,
    editedByName: slip?.edits?.updatedByName || ''
  };
}

/**
 * Turns what the editor sent into edits: only lines that differ from the
 * calculation are pinned. Throws a plain message for bad input.
 */
function editsFromRequest(slip, body = {}, user = {}) {
  const calculated = calculatedOf(slip);
  const current = payslipLines(slip);
  const known = new Set(current.earnings.map((l) => l.ref).concat(current.deductions.map((l) => l.ref)));
  const lines = {};
  for (const item of Array.isArray(body.lines) ? body.lines : []) {
    const ref = String(item?.ref || '');
    if (!known.has(ref)) continue;
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e8) throw new Error(`${ref.slice(2)}: enter an amount of 0 or more`);
    const side = ref.slice(0, 1);
    const key = ref.slice(2);
    if (!same(amount, lineValue(side, key, calculated.earnings, calculated.deductions))) lines[ref] = round2(amount);
  }
  const extra = [];
  for (const [i, item] of (Array.isArray(body.extra) ? body.extra : []).entries()) {
    const label = String(item?.label || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const amount = Number(item?.amount);
    if (!label && !amount) continue;
    if (!label) throw new Error('Give each added line a name (for example BONUS or LOAN RECOVERY)');
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e8) throw new Error(`${label}: enter an amount of 0 or more`);
    extra.push({ id: String(item.id || `x${Date.now().toString(36)}${i}`), side: item.side === 'D' ? 'D' : 'E', label: label.toUpperCase(), amount: round2(amount) });
  }
  const stats = slip?.attendanceStats || {};
  const info = {};
  const payable = body.info?.payableDays;
  const lop = body.info?.lopDays;
  if (payable !== undefined && payable !== '' && payable !== null) {
    const n = Number(payable);
    if (!Number.isFinite(n) || n < 0 || n > 31) throw new Error('Effective work days must be between 0 and 31');
    if (!same(n, stats.payableDays)) info.payableDays = round2(n);
  }
  if (lop !== undefined && lop !== '' && lop !== null) {
    const n = Number(lop);
    if (!Number.isFinite(n) || n < 0 || n > 31) throw new Error('LOP days must be between 0 and 31');
    if (!same(n, stats.attendanceLopDays)) info.lopDays = round2(n);
  }
  const notes = String(body.notes || '').trim().slice(0, 600);
  const edits = { lines, extra, notes, updatedAt: new Date(), updatedBy: user._id, updatedByName: user.name || '' };
  if (Object.keys(info).length) edits.info = info;
  const empty = !Object.keys(lines).length && !extra.length && !notes && !edits.info;
  return empty ? null : edits;
}

/* ---------------------------------------------------------------- words */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n) {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}
function belowThousand(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** Indian numbering: 13447 → "Thirteen Thousand Four Hundred Forty Seven"; 2500000 → "Twenty Five Lakh". */
function numberInWords(value) {
  let n = Math.floor(Math.abs(Number(value || 0)));
  if (!n) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${crore > 999 ? numberInWords(crore) : belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** "Rupees Thirteen Thousand Four Hundred Forty Seven Only" (with "and Paise …" when there are paise). */
function rupeesInWords(value) {
  const amount = round2(value);
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const sign = amount < 0 ? 'Minus ' : '';
  return `Rupees ${sign}${numberInWords(rupees)}${paise ? ` and Paise ${numberInWords(paise)}` : ''} Only`;
}

module.exports = {
  COMPONENTS,
  EARNING_LINES,
  DEDUCTION_LINES,
  applySlipEdits,
  calculatedFromEngine,
  calculatedOf,
  masterOf,
  payslipLines,
  editsFromRequest,
  retotal,
  numberInWords,
  rupeesInWords
};

/**
 * Loans and salary advances recovered from salary.
 *
 *   loanInstalmentsFor  the LOAN line of one employee's payslip for a month
 *   loanStatements      every loan with what is recovered and what is left
 *
 * What has been recovered is read from the payslips themselves: the LOAN line as
 * paid, so an instalment HR changed or skipped on a payslip counts as changed.
 * A person's payslips go to their oldest running loan first.
 */
const EmployeeLoan = require('../models/EmployeeLoan');
const SalarySlip = require('../models/SalarySlip');

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Does the loan take an instalment in `month` (YYYY-MM)? */
function runsIn(loan, month) {
  if (!loan.startMonth || loan.startMonth > month) return false;
  if (loan.status === 'CLOSED' && (!loan.closedMonth || loan.closedMonth <= month)) return false;
  return true;
}

/**
 * Recovered so far on each loan. `slips` in month order. A slip's LOAN line
 * pays each loan running that month its own instalment, oldest first (as the
 * payslip worked it out); anything more HR put on the line goes to the oldest
 * loan first, and a line HR lowered leaves the newest loans short first.
 */
function recoveredByLoan(loans, slips) {
  const recovered = new Map(loans.map((loan) => [String(loan._id), 0]));
  const leftOn = (loan) => Math.max(0, round2(num(loan.balanceAtStart) - recovered.get(String(loan._id))));
  const pay = (loan, amount) => recovered.set(String(loan._id), round2(recovered.get(String(loan._id)) + amount));
  for (const slip of slips) {
    let paid = round2(num(slip.deductions?.loan));
    if (paid <= 0) continue;
    const running = loans.filter((loan) => runsIn(loan, slip.month) && leftOn(loan) > 0);
    for (const loan of running) {
      if (paid <= 0) break;
      const take = Math.min(paid, num(loan.emi), leftOn(loan));
      pay(loan, take);
      paid = round2(paid - take);
    }
    for (const loan of running) {
      if (paid <= 0) break;
      const take = Math.min(paid, leftOn(loan));
      pay(loan, take);
      paid = round2(paid - take);
    }
  }
  return recovered;
}

/**
 * The LOAN line for one employee's payslip of `month`: each running loan's
 * instalment, never more than is left on it. `room` is the net pay before the
 * loan: instalments stop there, so a month with little salary never pays less
 * than nothing.
 */
async function loanInstalmentsFor({ tenantId, employeeId, month, room = Infinity }) {
  const loans = await EmployeeLoan.find({ tenantId, employeeId, startMonth: { $lte: month } }).sort('startMonth createdAt').lean();
  if (!loans.length) return { total: 0, lines: [] };
  const slips = await SalarySlip.find({ tenantId, employeeId, month: { $gte: loans[0].startMonth, $lt: month } })
    .select('month deductions.loan').sort('month').lean();
  const recovered = recoveredByLoan(loans, slips);
  let available = room === Infinity ? Infinity : Math.max(0, num(room));
  const lines = [];
  for (const loan of loans) {
    if (!runsIn(loan, month)) continue;
    const left = round2(num(loan.balanceAtStart) - recovered.get(String(loan._id)));
    const amount = round2(Math.min(num(loan.emi), left, available));
    if (amount <= 0) continue;
    available -= amount;
    lines.push({ loanId: loan._id, name: loan.name || 'Loan', amount, balanceAfter: round2(left - amount) });
  }
  return { total: round2(lines.reduce((t, l) => t + l.amount, 0)), lines };
}

/** Every loan (of the employees given, or all) with what is recovered and what is left, from the payslips saved so far. */
async function loanStatements({ tenantId, employeeIds = null }) {
  const filter = { tenantId };
  if (employeeIds) filter.employeeId = { $in: employeeIds };
  const loans = await EmployeeLoan.find(filter)
    .populate('employeeId', 'employeeCode firstName lastName workLocation status')
    .sort('startMonth createdAt').lean();
  const byEmployee = new Map();
  for (const loan of loans) {
    const id = String(loan.employeeId?._id || loan.employeeId);
    if (!byEmployee.has(id)) byEmployee.set(id, []);
    byEmployee.get(id).push(loan);
  }
  const rows = [];
  for (const [employeeId, list] of byEmployee) {
    // Loans saved by the earlier HRMS may have no first month; they recover nothing here.
    const firstMonth = list.map((loan) => loan.startMonth).filter(Boolean).sort()[0];
    const slips = firstMonth
      ? await SalarySlip.find({ tenantId, employeeId, month: { $gte: firstMonth } }).select('month deductions.loan').sort('month').lean()
      : [];
    const recovered = recoveredByLoan(list, slips);
    for (const loan of list) {
      const got = recovered.get(String(loan._id));
      const left = Math.max(0, round2(num(loan.balanceAtStart) - got));
      const state = loan.status === 'CLOSED' ? 'CLOSED' : left <= 0 ? 'RECOVERED' : 'ACTIVE';
      rows.push({
        ...loan,
        recovered: got,
        left,
        instalmentsLeft: state === 'ACTIVE' ? Math.ceil(left / Math.max(1, num(loan.emi))) : 0,
        state
      });
    }
  }
  return rows.sort((a, b) => String(a.employeeId?.employeeCode || '').localeCompare(String(b.employeeId?.employeeCode || '')) || String(a.startMonth || '').localeCompare(String(b.startMonth || '')));
}

module.exports = { loanInstalmentsFor, loanStatements, recoveredByLoan, runsIn };

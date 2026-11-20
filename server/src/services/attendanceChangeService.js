/**
 * What happens after someone changes attendance (a correction, a leave decision,
 * an HR override, a calendar action):
 *
 * 1. The employee's whole month is evaluated again. The monthly late / early
 *    quota is counted in date order, so fixing the 5th can change what the 20th
 *    owes. Days whose result did not change are not written again.
 * 2. The payroll draft for that month follows at once (payrollSlipService).
 *
 * Returns { payroll, payrollNote } for the response. Never throws for payroll:
 * the attendance change is already saved by the time this runs.
 */
const { evaluateMonth } = require('./attendanceRulesService');
const { syncPayrollAfterChange, monthsOf } = require('./payrollSlipService');

async function settleAttendanceChange(req, { employeeIds = [], dates = [], months = [], reevaluate = true } = {}) {
  const ids = Array.from(new Set(employeeIds.filter(Boolean).map(String)));
  const wanted = Array.from(new Set([...monthsOf(dates), ...months])).sort();
  if (!ids.length || !wanted.length) return { payroll: [], payrollNote: '' };
  if (reevaluate) {
    for (const month of wanted) {
      try {
        await evaluateMonth({ tenantId: req.tenantId, employeeIds: ids, month });
      } catch (error) {
        console.warn(`[attendance] could not re-evaluate ${month} after a change: ${error.message}`);
      }
    }
  }
  return syncPayrollAfterChange(req, { employeeIds: ids, months: wanted });
}

/** "Saved." + " November 2026 payroll draft updated…" */
function withPayrollNote(message, note) {
  if (!note) return message;
  const base = String(message || '').trim();
  return base ? `${base.replace(/[.\s]*$/, '.')} ${note}` : note;
}

module.exports = { settleAttendanceChange, withPayrollNote };

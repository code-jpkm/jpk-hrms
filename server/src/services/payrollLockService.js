/**
 * Payroll lock: a month's payroll opens on the 1st of the next month.
 *
 * With the lock on (the default) November's payroll can be generated from
 * 1 December, and an employee never sees a payslip for a month that has not
 * ended. HR turns the lock off in Payroll → Statutory rules.
 */
const { companyToday } = require('../utils/date');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function payrollLockOn(rule) {
  // A rule saved before the setting existed has no value: that is "on".
  return rule?.lockUntilMonthEnds !== false;
}

/** Today on the company clock, as YYYY-MM-DD. */
function companyTodayKey(now = new Date()) {
  return companyToday(now).toISOString().slice(0, 10);
}

function nextMonthKey(month) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const d = new Date(Date.UTC(year, monthNumber, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "2026-11" → "2026-12-01": the day the month's payroll opens. */
function monthOpensOn(month) {
  return `${nextMonthKey(month)}-01`;
}

function isMonthOpen(month, now = new Date()) {
  return companyTodayKey(now) >= monthOpensOn(month);
}

function monthName(month) {
  const [year, monthNumber] = String(month).split('-').map(Number);
  return `${MONTHS[monthNumber - 1] || month} ${year}`;
}

function dayName(dayKey) {
  const [year, monthNumber, day] = String(dayKey).split('-').map(Number);
  return `${day} ${MONTHS[monthNumber - 1] || ''} ${year}`;
}

/** The reason a month cannot be generated yet, or '' when it can. */
function lockedReason(rule, month, now = new Date()) {
  if (!payrollLockOn(rule) || isMonthOpen(month, now)) return '';
  return `${monthName(month)} payroll opens on ${dayName(monthOpensOn(month))}, after the month ends. To make it earlier, turn off "Lock payroll until the month ends" in Payroll → Statutory rules.`;
}

module.exports = { payrollLockOn, companyTodayKey, nextMonthKey, monthOpensOn, isMonthOpen, monthName, dayName, lockedReason };

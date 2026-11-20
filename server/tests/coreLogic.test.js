const assert = require('assert');
const { statusFromWorkedMinutes, computeShiftWindow, minutesBetween } = require('../src/utils/shift');
const { calculateSalary } = require('../src/utils/salary');

function at(hour, minute = 0) {
  return new Date(2026, 6, 1, hour, minute, 0, 0);
}

function testAttendanceClassification() {
  const shift = { halfDayMinutes: 240, fullDayMinutes: 450 };

  // A zero-minute punch pair is never attendance.
  assert.equal(statusFromWorkedMinutes(shift, at(9), at(9)), 'ABSENT');
  // Below the half-day minimum: HALF_DAY by default (v25 policy) ...
  assert.equal(statusFromWorkedMinutes(shift, at(9), at(12)), 'HALF_DAY');
  // ... or ABSENT when Attendance Rules -> "Short day counts as" is set to Absent.
  assert.equal(statusFromWorkedMinutes(shift, at(9), at(12), 'PRESENT', { belowHalfDayStatus: 'ABSENT' }), 'ABSENT');
  // At or above the half-day minimum the punch pair is PRESENT; the late-in /
  // early-leave rules (monthly exception quota, half-day early-leave threshold)
  // decide any LOP. This is the v25 design and keeps late arrivals from
  // silently becoming half days.
  assert.equal(statusFromWorkedMinutes(shift, at(9), at(14)), 'PRESENT');
  assert.equal(statusFromWorkedMinutes(shift, at(9), at(17)), 'PRESENT');
}


function testShiftEditDoesNotKeepStaleFullDayThreshold() {
  const editedShift = { startTime: '10:00', endTime: '18:00', fullDayMinutes: 540, halfDayMinutes: 270 };
  const checkIn = new Date('2026-08-03T04:26:00.000Z'); // 09:56 IST
  const checkOut = new Date('2026-08-03T12:39:00.000Z'); // 18:09 IST
  assert.equal(statusFromWorkedMinutes(editedShift, checkIn, checkOut), 'PRESENT');
}

function testIndiaShiftWindowOnUtcServer() {
  const shift = { startTime: '10:00', endTime: '18:00', durationMinutes: 480 };
  const attendanceDate = new Date('2026-08-03T00:00:00.000Z');
  const window = computeShiftWindow(shift, attendanceDate, 330);
  assert.equal(window.start.toISOString(), '2026-08-03T04:30:00.000Z');
  assert.equal(window.end.toISOString(), '2026-08-03T12:30:00.000Z');
  const checkOut = new Date('2026-08-03T12:39:00.000Z'); // 18:09 IST
  assert.equal(Math.max(0, minutesBetween(checkOut, window.end)), 0);
}

function testSalaryProrationAndDeductions() {
  const salaryMaster = {
    _id: 'salary-master-test',
    effectiveMonth: '2026-07',
    calculationMode: 'RULE_BASED_DEDUCTIONS',
    grossSalary: 52000,
    earnings: {
      basic: 26000,
      hra: 10400,
      conveyance: 1600,
      specialAllowance: 14000,
      otherEarnings: 0
    },
    deductions: { pf: 0, esi: 0, ptax: 0, otherDeductions: 0 },
    toObject() { return { ...this }; }
  };

  const rule = {
    pf: {
      enabled: true,
      employeePercent: 0.12,
      wageCap: 15000,
      calculationBase: 'BASIC',
      applyWageCap: true
    },
    esi: {
      enabled: true,
      employeePercent: 0.0075,
      grossCap: 21000,
      calculationBase: 'GROSS'
    },
    ptax: {
      enabled: true,
      defaultAmount: 200,
      slabs: [
        { from: 0, to: 10000, amount: 0 },
        { from: 10001, to: 15000, amount: 110 },
        { from: 15001, to: 9999999, amount: 200 }
      ]
    }
  };

  const result = calculateSalary({
    employee: { salary: {} },
    attendanceStats: { workingDays: 26, payableDays: 25 },
    rule,
    salaryMaster
  });

  assert.equal(result.proratedGross, 50000);
  assert.equal(result.deductions.pf, 1800);
  assert.equal(result.deductions.esi, 0);
  assert.equal(result.deductions.ptax, 200);
  assert.equal(result.netPay, 48000);
}

// JPK's own payslip (Google Sheets, Jan 2026): master 9480 / 3792 / 1600 / 2128 = 17000,
// 31 days, 4 LOP. The whole-rupee payroll must give exactly the same slip.
function testJpkSamplePayslipInWholeRupees() {
  const salaryMaster = {
    _id: 'jpk-sample',
    effectiveMonth: '2026-01',
    calculationMode: 'RULE_BASED_DEDUCTIONS',
    grossSalary: 17000,
    earnings: { basic: 9480, hra: 3792, conveyance: 1600, specialAllowance: 2128, otherEarnings: 0 },
    deductions: { pf: 0, esi: 0, ptax: 0, otherDeductions: 0 },
    toObject() { return { ...this }; }
  };
  const rule = {
    pf: { enabled: true, employeePercent: 0.12, wageCap: 15000, calculationBase: 'BASIC', applyWageCap: true },
    esi: { enabled: true, employeePercent: 0.0075, grossCap: 21000, calculationBase: 'GROSS' },
    ptax: { enabled: true, defaultAmount: 200, slabs: [{ from: 0, to: 10000, amount: 0 }, { from: 10001, to: 15000, amount: 110 }, { from: 15001, to: 25000, amount: 130 }, { from: 25001, to: 40000, amount: 150 }, { from: 40001, to: 9999999, amount: 200 }] }
  };
  const stats = { workingDays: 31, payableDays: 27 };
  const slip = calculateSalary({ employee: { salary: {} }, attendanceStats: stats, rule, salaryMaster });
  assert.equal(slip.lop.amount, 2194);
  assert.deepEqual([slip.basic, slip.hra, slip.conveyance, slip.specialAllowance], [9480, 3792, 1534, 0]);
  assert.equal(slip.proratedGross, 14806);
  assert.deepEqual([slip.deductions.pf, slip.deductions.esi, slip.deductions.ptax, slip.deductions.total], [1138, 111, 110, 1359]);
  assert.equal(slip.netPay, 13447);
  assert.deepEqual(slip.contractEarnings, { basic: 9480, hra: 3792, conveyance: 1600, specialAllowance: 2128, otherEarnings: 0 });

  // A rule can keep paise instead.
  const exact = calculateSalary({ employee: { salary: {} }, attendanceStats: stats, rule: { ...rule, roundToRupee: false }, salaryMaster });
  assert.equal(exact.lop.amount, 2193.55);
  assert.equal(exact.conveyance, 1534.45);
  assert.equal(exact.deductions.pf, 1137.6);
}

testAttendanceClassification();
testIndiaShiftWindowOnUtcServer();
testShiftEditDoesNotKeepStaleFullDayThreshold();
testSalaryProrationAndDeductions();
testJpkSamplePayslipInWholeRupees();
console.log('PASS: attendance classification and payroll calculation core tests');

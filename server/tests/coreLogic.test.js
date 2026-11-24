const assert = require('assert');
const { statusFromWorkedMinutes, computeShiftWindow, minutesBetween } = require('../src/utils/shift');
const { calculateSalary, ptaxForGross } = require('../src/utils/salary');
const { recoveredByLoan, runsIn } = require('../src/services/loanService');

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

// JPK from Nov 2026, as in greytHR: PF on the full Basic, ESI 0.75% of Basic and none
// above ₹21,000 Basic, P.Tax "up to" slabs on the month's gross.
function testJpkStatutoryAsGreytHR() {
  const rule = {
    pf: { enabled: true, employeePercent: 0.12, wageCap: 15000, calculationBase: 'BASIC', applyWageCap: false },
    esi: { enabled: true, employeePercent: 0.0075, grossCap: 21000, calculationBase: 'BASIC' },
    ptax: { enabled: true, defaultAmount: 208, slabs: [{ from: 0, to: 20000, amount: 0 }, { from: 20001, to: 30000, amount: 100 }, { from: 30001, to: 50000, amount: 140 }, { from: 50001, to: 100000, amount: 170 }] }
  };
  const master = (basic, other) => ({ calculationMode: 'RULE_BASED_DEDUCTIONS', earnings: { basic, hra: 0, conveyance: 0, specialAllowance: other, otherEarnings: 0 }, grossSalary: basic + other, deductions: {} });
  const full = { workingDays: 26, payableDays: 26 };
  // A greytHR October 2026 payslip with Basic above 21,000: PF on the full Basic, no ESI, P.Tax 170.
  let slip = calculateSalary({ employee: {}, attendanceStats: full, rule, salaryMaster: master(39367, 34643) });
  assert.deepEqual([slip.deductions.pf, slip.deductions.esi, slip.deductions.ptax], [4724, 0, 170]);
  // A greytHR payslip with Basic 10,500: PF 1,260, ESI 79, no P.Tax.
  slip = calculateSalary({ employee: {}, attendanceStats: full, rule, salaryMaster: master(10500, 5099) });
  assert.deepEqual([slip.deductions.pf, slip.deductions.esi, slip.deductions.ptax], [1260, 79, 0]);
  // Basic 22,000 agreed: no ESI even when loss of pay brings the earned Basic under 21,000.
  slip = calculateSalary({ employee: {}, attendanceStats: { workingDays: 26, payableDays: 13 }, rule, salaryMaster: master(22000, 0) });
  assert.equal(slip.basic, 11000);
  assert.equal(slip.deductions.esi, 0);
  // Basic exactly 21,000: ESI applies.
  slip = calculateSalary({ employee: {}, attendanceStats: full, rule, salaryMaster: master(21000, 9000) });
  assert.equal(slip.deductions.esi, 158);
  // greytHR's own October 2026 payslips with LOP (names left out): the LOP comes off Special Allowance, then Conveyance.
  const parts = (basic, hra, conveyance, specialAllowance) => ({ calculationMode: 'RULE_BASED_DEDUCTIONS', earnings: { basic, hra, conveyance, specialAllowance, otherEarnings: 0 }, grossSalary: basic + hra + conveyance + specialAllowance, deductions: {} });
  // 3 LOP days of 31.
  slip = calculateSalary({ employee: {}, attendanceStats: { workingDays: 31, payableDays: 28 }, rule, salaryMaster: parts(10500, 4200, 1600, 3169) });
  assert.deepEqual([slip.lop.amount, slip.specialAllowance, slip.proratedGross, slip.deductions.pf, slip.deductions.esi, slip.deductions.ptax, slip.netPay], [1884, 1285, 17585, 1260, 79, 0, 16246]);
  // 4 LOP days of 31: Special Allowance used up, then part of Conveyance.
  slip = calculateSalary({ employee: {}, attendanceStats: { workingDays: 31, payableDays: 27 }, rule, salaryMaster: parts(10500, 4200, 1600, 1169) });
  assert.deepEqual([slip.conveyance, slip.specialAllowance, slip.proratedGross, slip.netPay], [515, 0, 15215, 13876]);
  // Wages staff: 4.5 LOP days of 27.
  slip = calculateSalary({ employee: {}, attendanceStats: { workingDays: 27, payableDays: 22.5 }, rule, salaryMaster: parts(14607, 5842.8, 1600, 7163.2) });
  assert.deepEqual([slip.specialAllowance, slip.proratedGross, slip.deductions.pf, slip.deductions.esi, slip.deductions.ptax, slip.netPay], [2294, 24344, 1753, 110, 100, 22381]);
  // The user's formula: IF(R<=20000,0,IF(R<=30000,100,IF(R<=50000,140,IF(R<=100000,170,208))))
  for (const [gross, tax] of [[0, 0], [20000, 0], [20000.4, 100], [20001, 100], [30000, 100], [30000.5, 140], [50000, 140], [50001, 170], [100000, 170], [100000.01, 208], [250000, 208]]) {
    assert.equal(ptaxForGross(gross, rule.ptax), tax, `P.Tax on ${gross}`);
  }
  // Older rules keep working: no slab matches -> the default amount.
  assert.equal(ptaxForGross(45000, { defaultAmount: 200, slabs: [{ from: 0, to: 10000, amount: 0 }, { from: 10001, to: 40000, amount: 150 }] }), 200);
}

// Loans: the payslips' LOAN lines go to the oldest running loan first; a closed loan stops.
function testLoanRecovery() {
  const a = { _id: 'a', startMonth: '2026-11', balanceAtStart: 6000, emi: 2000, status: 'ACTIVE' };
  const b = { _id: 'b', startMonth: '2026-12', balanceAtStart: 1000, emi: 500, status: 'ACTIVE' };
  const slips = [{ month: '2026-11', deductions: { loan: 2000 } }, { month: '2026-12', deductions: { loan: 2500 } }, { month: '2027-01', deductions: { loan: 0 } }];
  const got = recoveredByLoan([a, b], slips);
  assert.equal(got.get('a'), 4000);
  assert.equal(got.get('b'), 500);
  // HR put 3,000 on the LOAN line in January: the extra 1,000 goes to the older loan.
  const more = recoveredByLoan([a, b], [...slips.slice(0, 2), { month: '2027-01', deductions: { loan: 3000 } }]);
  assert.equal(more.get('a'), 6000);
  assert.equal(more.get('b'), 1000);
  // HR lowered December's line to 2,000: the newer loan is the one left short.
  const less = recoveredByLoan([a, b], [slips[0], { month: '2026-12', deductions: { loan: 2000 } }]);
  assert.equal(less.get('a'), 4000);
  assert.equal(less.get('b'), 0);
  // A payslip before a loan starts never counts for it.
  assert.equal(recoveredByLoan([b], [{ month: '2026-11', deductions: { loan: 900 } }]).get('b'), 0);
  // More than is left on a loan is not counted twice.
  assert.equal(recoveredByLoan([{ ...a, balanceAtStart: 1000 }], [{ month: '2026-11', deductions: { loan: 2000 } }]).get('a'), 1000);
  const closed = { ...a, status: 'CLOSED', closedMonth: '2027-01' };
  assert.equal(runsIn(closed, '2026-12'), true);
  assert.equal(runsIn(closed, '2027-01'), false);
  assert.equal(runsIn(a, '2026-10'), false);
}

function testPayrollLock() {
  const { isMonthOpen, monthOpensOn, lockedReason, payrollLockOn, nextMonthKey } = require('../src/services/payrollLockService');
  assert.equal(monthOpensOn('2026-11'), '2026-12-01');
  assert.equal(monthOpensOn('2026-12'), '2027-01-01');
  assert.equal(nextMonthKey('2027-01'), '2027-02');
  // India time decides: 30 Nov 23:59 IST is still November; 1 Dec 00:00 IST opens it.
  assert.equal(isMonthOpen('2026-11', new Date('2026-11-30T18:29:00Z')), false);
  assert.equal(isMonthOpen('2026-11', new Date('2026-11-30T18:30:00Z')), true);
  assert.equal(isMonthOpen('2026-10', new Date('2026-11-23T12:00:00Z')), true);
  // On unless HR turned it off; a rule saved before the setting existed counts as on.
  assert.equal(payrollLockOn(null), true);
  assert.equal(payrollLockOn({}), true);
  assert.equal(payrollLockOn({ lockUntilMonthEnds: false }), false);
  assert.match(lockedReason({}, '2026-11', new Date('2026-11-23T12:00:00Z')), /November 2026 payroll opens on 1 December 2026/);
  assert.equal(lockedReason({ lockUntilMonthEnds: false }, '2026-11', new Date('2026-11-23T12:00:00Z')), '');
  assert.equal(lockedReason({}, '2026-10', new Date('2026-11-23T12:00:00Z')), '');
}

function testFactoryFingerprintOnly() {
  const { fingerprintOnly, employeeForSelf, factoryFingerprintOnlyOn } = require('../src/services/attendanceModeService');
  const factory = { workLocation: 'FACTORY', canUseGeofencing: true, canUseAnywhereAttendance: true, canApplyWfh: true };
  const office = { workLocation: 'OFFICE', canUseGeofencing: true, canUseAnywhereAttendance: false, canApplyWfh: true };
  assert.equal(factoryFingerprintOnlyOn(null), true);
  assert.equal(factoryFingerprintOnlyOn({ attendance: {} }), true);
  assert.equal(fingerprintOnly(factory, {}), true);
  assert.equal(fingerprintOnly({ ...factory, workLocation: 'factory' }, {}), true);
  assert.equal(fingerprintOnly(factory, { attendance: { factoryFingerprintOnly: false } }), false);
  assert.equal(fingerprintOnly(office, {}), false);
  assert.equal(fingerprintOnly({ workLocation: 'BOTH' }, {}), false);
  const seen = employeeForSelf(factory, true);
  assert.deepEqual([seen.canUseGeofencing, seen.canUseAnywhereAttendance, seen.canApplyWfh, seen.fingerprintOnly], [false, false, false, true]);
  assert.equal(factory.canApplyWfh, true, 'the stored record is not changed');
  const officeSeen = employeeForSelf(office, false);
  assert.deepEqual([officeSeen.canUseGeofencing, officeSeen.canApplyWfh, officeSeen.fingerprintOnly], [true, true, false]);
}

// October 2026 at JPK: holidays 2, 19, 20, 21 (Fri, Mon, Tue, Wed). A WAGES
// worker present on every other non-Sunday is paid all 27 days, as in greytHR.
async function testWagesHolidayIsPaid() {
  const Holiday = require('../src/models/Holiday');
  const ShiftAssignment = require('../src/models/ShiftAssignment');
  const Attendance = require('../src/models/Attendance');
  const { attendanceStatsFor } = require('../src/services/payrollSlipService');
  const { monthRange, eachDate, dateKey } = require('../src/utils/date');
  const saved = { holiday: Holiday.find, assignment: ShiftAssignment.find, attendance: Attendance.find };
  const holidayDays = ['2026-10-02', '2026-10-19', '2026-10-20', '2026-10-21'];
  const { from, to } = monthRange('2026-10');
  const worked = eachDate(from, to).filter((d) => d.getDay() !== 0 && !holidayDays.includes(dateKey(d)));
  Holiday.find = async () => holidayDays.map((day) => ({ date: new Date(`${day}T00:00:00Z`), name: 'Puja', location: 'ALL' }));
  ShiftAssignment.find = () => ({ populate: () => ({ sort: async () => [] }) });
  Attendance.find = async () => worked.map((date) => ({ date, status: 'PRESENT', lopDays: 0 }));
  try {
    const base = { _id: 'e1', workLocation: 'FACTORY', dateOfJoining: new Date('2020-01-01') };
    const wages = await attendanceStatsFor({ ...base, employeeCategory: 'WAGES' }, '2026-10', 't1');
    assert.equal(worked.length, 23);
    assert.deepEqual([wages.workingDays, wages.payableDays, wages.attendanceLopDays, wages.missingAbsentDays], [27, 27, 0, 0]);
    // Salaried: one LOP day is the salary ÷ all 31 days, like JPK's payslips and greytHR.
    const salaried = await attendanceStatsFor({ ...base, employeeCategory: 'SALARIED' }, '2026-10', 't1');
    assert.deepEqual([salaried.workingDays, salaried.payableDays, salaried.attendanceLopDays, salaried.scheduledWorkingDays, salaried.dayBasis], [31, 31, 0, 23, 'CALENDAR_DAYS']);
    const byWorking = await attendanceStatsFor({ ...base, employeeCategory: 'SALARIED' }, '2026-10', 't1', { lopDayBasis: 'WORKING_DAYS' });
    assert.deepEqual([byWorking.workingDays, byWorking.payableDays, byWorking.dayBasis], [23, 23, 'WORKING_DAYS']);
    // Joined on 5 Oct: paid on the 27 days from joining, as greytHR does.
    const joiner = await attendanceStatsFor({ ...base, employeeCategory: 'SALARIED', dateOfJoining: new Date(2026, 9, 5) }, '2026-10', 't1');
    assert.deepEqual([joiner.workingDays, joiner.payableDays], [27, 27]);
    // A non-holiday day with no attendance is still LOP.
    Attendance.find = async () => worked.slice(1).map((date) => ({ date, status: 'PRESENT', lopDays: 0 }));
    const oneAbsent = await attendanceStatsFor({ ...base, employeeCategory: 'WAGES' }, '2026-10', 't1');
    assert.deepEqual([oneAbsent.attendanceLopDays, oneAbsent.payableDays, oneAbsent.dayBasis], [1, 26, 'DAYS_LESS_SUNDAYS']);
    const oneAbsentSalaried = await attendanceStatsFor({ ...base, employeeCategory: 'SALARIED' }, '2026-10', 't1');
    assert.deepEqual([oneAbsentSalaried.attendanceLopDays, oneAbsentSalaried.payableDays], [1, 30]);
  } finally {
    Holiday.find = saved.holiday;
    ShiftAssignment.find = saved.assignment;
    Attendance.find = saved.attendance;
  }
}

testPayrollLock();
testFactoryFingerprintOnly();
testAttendanceClassification();
testIndiaShiftWindowOnUtcServer();
testShiftEditDoesNotKeepStaleFullDayThreshold();
testSalaryProrationAndDeductions();
testJpkSamplePayslipInWholeRupees();
testJpkStatutoryAsGreytHR();
testLoanRecovery();
testWagesHolidayIsPaid()
  .then(() => console.log('PASS: attendance classification and payroll calculation core tests'))
  .catch((error) => { console.error(error); process.exit(1); });

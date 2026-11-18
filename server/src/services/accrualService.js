const Employee = require('../models/Employee');
const LeaveBalance = require('../models/LeaveBalance');

function previousMonthKey(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isStillInProbation(employee, now = new Date()) {
  if (employee.probation?.enabled === false) return false;
  if (['CONFIRMED', 'OFFBOARDED'].includes(employee.status)) return false;
  const endDate = employee.probation?.extendedUntil || employee.probation?.endDate;
  return endDate ? new Date(endDate) >= now : employee.status === 'PROBATION';
}

function accrualForEmployee(employee) {
  // Company rule requested by user: regular confirmed/salaried staff gets 2 EL monthly,
  // wages staff gets 1.5 EL monthly. Probation employees are skipped.
  return employee.employeeCategory === 'WAGES' ? 1.5 : 2;
}

async function accrueMonthlyLeavesForTenant(tenantId, now = new Date()) {
  const accrualMonth = previousMonthKey(now);
  const employees = await Employee.find({ tenantId, status: { $in: ['ACTIVE', 'CONFIRMED'] } });
  let updated = 0;
  let skippedProbation = 0;

  for (const employee of employees) {
    if (isStillInProbation(employee, now)) {
      skippedProbation += 1;
      continue;
    }
    const amount = accrualForEmployee(employee);
    const balance = await LeaveBalance.findOneAndUpdate(
      { tenantId, employeeId: employee._id, leaveType: 'EL' },
      { $setOnInsert: { accrued: 0, used: 0, manualAdjusted: 0, carriedForward: 0 } },
      { upsert: true, new: true }
    );
    if (balance.lastAccruedForMonth === accrualMonth) continue;
    balance.accrued += amount;
    balance.lastAccruedForMonth = accrualMonth;
    await balance.save();
    updated += 1;
  }
  return { tenantId, accrualMonth, updated, skippedProbation };
}

module.exports = { accrueMonthlyLeavesForTenant, isStillInProbation, accrualForEmployee };

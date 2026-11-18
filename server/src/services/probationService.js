const Tenant = require('../models/Tenant');
const Employee = require('../models/Employee');
const ProbationReview = require('../models/ProbationReview');
const { notify, recipientsForRoles } = require('./messaging/dispatcher');

const { addMonthsClamped } = require('../utils/date');

// 31 Jan + 1 month must land on 28/29 Feb, not roll over to early March.
function addMonths(date, months) {
  return addMonthsClamped(date, Number(months || 6));
}

async function ensureProbationReview(employee) {
  if (!employee.probation?.enabled || !employee.probation?.endDate) return null;
  return ProbationReview.findOneAndUpdate(
    { tenantId: employee.tenantId, employeeId: employee._id, dueDate: employee.probation.endDate },
    { tenantId: employee.tenantId, employeeId: employee._id, managerEmployeeId: employee.reportsTo, dueDate: employee.probation.endDate },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function runProbationReminders(now = new Date(), { tenantId } = {}) {
  // The scheduler runs every tenant; the "Run reminders now" button only its own.
  const tenants = await Tenant.find({ status: 'ACTIVE', ...(tenantId ? { _id: tenantId } : {}) });
  let created = 0;
  let reminded = 0;
  for (const tenant of tenants) {
    const dueBefore = new Date(now);
    dueBefore.setDate(dueBefore.getDate() + 7);
    const employees = await Employee.find({
      tenantId: tenant._id,
      status: { $in: ['ACTIVE', 'PROBATION'] },
      'probation.enabled': { $ne: false },
      'probation.status': { $in: ['RUNNING', 'CONFIRMATION_DUE', 'EXTENDED'] },
      'probation.endDate': { $lte: dueBefore }
    }).populate({ path: 'reportsTo', populate: { path: 'userId' } });
    for (const employee of employees) {
      employee.probation.status = 'CONFIRMATION_DUE';
      await employee.save();
      const review = await ensureProbationReview(employee);
      if (review) created += 1;
      const manager = employee.reportsTo;
      const canRemind = !review?.lastReminderAt || (now - new Date(review.lastReminderAt)) > 24 * 60 * 60 * 1000;
      if (canRemind) {
        const name = `${employee.firstName} ${employee.lastName || ''}`.trim();
        // Manager first; HR always gets a copy so a missing manager mapping never hides it.
        const recipients = [
          ...(manager?.userId ? [{ userId: manager.userId._id, employeeId: manager._id }] : []),
          ...(await recipientsForRoles(tenant._id, ['HR_ADMIN']))
        ];
        await notify({
          tenantId: tenant._id,
          event: 'PROBATION_DUE',
          recipients,
          path: '/probation',
          entityId: `${employee._id}:${now.toISOString().slice(0, 10)}`,
          data: { employeeName: name, employeeCode: employee.employeeCode, endDate: employee.probation.endDate },
          inApp: { type: 'PROBATION_DUE', title: `Probation review due: ${name}`, body: `${employee.employeeCode} · probation ends soon. Confirm or extend it.`, priority: 'HIGH' }
        });
        if (review) {
          review.remindersSent += 1;
          review.lastReminderAt = now;
          await review.save();
        }
        employee.probation.lastReminderAt = now;
        await employee.save();
        reminded += 1;
      }
    }
  }
  return { created, reminded };
}

async function confirmProbation({ review, user, remarks }) {
  const employee = await Employee.findOne({ _id: review.employeeId, tenantId: review.tenantId });
  employee.status = 'CONFIRMED';
  employee.probation.status = 'CONFIRMED';
  employee.probation.confirmedAt = new Date();
  employee.probation.confirmedBy = user._id;
  await employee.save();
  review.status = 'CONFIRMED';
  review.managerRemarks = remarks;
  review.decidedBy = user._id;
  review.decidedAt = new Date();
  await review.save();
  return employee;
}

async function extendProbation({ review, user, extensionMonths, remarks }) {
  const employee = await Employee.findOne({ _id: review.employeeId, tenantId: review.tenantId });
  const extendedUntil = addMonths(employee.probation.endDate || new Date(), extensionMonths || 1);
  employee.status = 'PROBATION';
  employee.probation.status = 'EXTENDED';
  employee.probation.extendedUntil = extendedUntil;
  employee.probation.endDate = extendedUntil;
  await employee.save();
  review.status = 'EXTENDED';
  review.extensionMonths = Number(extensionMonths || 1);
  review.extendedUntil = extendedUntil;
  review.managerRemarks = remarks;
  review.decidedBy = user._id;
  review.decidedAt = new Date();
  await review.save();
  await ensureProbationReview(employee);
  return employee;
}

module.exports = { ensureProbationReview, runProbationReminders, confirmProbation, extendProbation };

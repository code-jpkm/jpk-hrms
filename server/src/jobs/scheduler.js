const cron = require('node-cron');
const Tenant = require('../models/Tenant');
const Employee = require('../models/Employee');
const Holiday = require('../models/Holiday');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const Regularization = require('../models/Regularization');
const ShiftAssignment = require('../models/ShiftAssignment');
const Shift = require('../models/Shift');
const { computeShiftWindow, assignmentAppliesOnWeekday } = require('../utils/shift');
const { accrueMonthlyLeavesForTenant } = require('../services/accrualService');
const { syncAllDevices } = require('../services/biometricService');
const { processAllPending: addWaitingMachinePunches } = require('../services/admsService');
const { runProbationReminders } = require('../services/probationService');
const { notifyRoles } = require('../services/inAppNotificationService');
const { notify, recipientsForRoles } = require('../services/messaging/dispatcher');
const { composeMessage, dailyDigestText, istTodayKey, dayWindow } = require('../services/ai/aiFeatures');
const { isAvailable } = require('../services/ai/geminiClient');
const { semanticDateKey, holidayDateKey } = require('../utils/date');

// v26: every job runs on the company clock. node-cron otherwise uses the
// server's timezone, and Render servers run in UTC — so the 08:30 birthday
// job fired at 2 pm IST and the "00:10 on the 1st" accrual at 5:40 am.
const TZ = process.env.HRMS_TIMEZONE || 'Asia/Kolkata';

function job(name, expression, fn) {
  cron.schedule(expression, async () => {
    try {
      await fn();
    } catch (error) {
      // A failing job must never take the API down with it.
      console.error(`[cron:${name}] failed:`, error && error.stack ? error.stack : error);
    }
  }, { timezone: TZ });
}

async function activeTenants() {
  return Tenant.find({ status: 'ACTIVE' }).select('_id name').lean();
}

async function sendCelebrations(now = new Date()) {
  const todayKey = istTodayKey(now);
  const mmdd = todayKey.slice(5);
  const year = Number(todayKey.slice(0, 4));
  for (const tenant of await activeTenants()) {
    const employees = await Employee.find({ tenantId: tenant._id, status: { $ne: 'OFFBOARDED' } }).select('firstName lastName dateOfBirth dateOfJoining userId email phone').lean();
    const items = [];
    const aiOn = await isAvailable(tenant._id, 'MESSAGES');
    for (const e of employees) {
      const name = `${e.firstName} ${e.lastName || ''}`.trim();
      if (e.dateOfBirth && semanticDateKey(e.dateOfBirth).slice(5) === mmdd) {
        const message = aiOn ? (await composeMessage({ tenantId: tenant._id, purpose: 'BIRTHDAY', employeeId: e._id, channel: 'WHATSAPP' })).text : undefined;
        await notify({ tenantId: tenant._id, event: 'BIRTHDAY_WISH', recipients: [{ employee: e, employeeId: e._id }], entityId: `${e._id}:${year}`, data: { message }, inApp: { type: 'BIRTHDAY', title: `Happy birthday, ${e.firstName}! 🎂`, body: message || 'Wishing you a wonderful year ahead from everyone at work.' } });
        items.push({ type: 'BIRTHDAY', name });
      }
      if (e.dateOfJoining) {
        const joinKey = semanticDateKey(e.dateOfJoining);
        const years = year - Number(joinKey.slice(0, 4));
        if (years > 0 && joinKey.slice(5) === mmdd) {
          const message = aiOn ? (await composeMessage({ tenantId: tenant._id, purpose: 'ANNIVERSARY', employeeId: e._id, channel: 'WHATSAPP' })).text : undefined;
          await notify({ tenantId: tenant._id, event: 'ANNIVERSARY_WISH', recipients: [{ employee: e, employeeId: e._id }], entityId: `${e._id}:${year}`, data: { message, years }, inApp: { type: 'ANNIVERSARY', title: `Happy ${years}-year work anniversary, ${e.firstName}!`, body: message || 'Thank you for being part of the team.' } });
          items.push({ type: 'ANNIVERSARY', name, years });
        }
      }
    }
    if (items.length) {
      await notify({ tenantId: tenant._id, event: 'CELEBRATIONS_DIGEST', recipients: await recipientsForRoles(tenant._id, ['SUPER_ADMIN', 'HR_ADMIN']), entityId: todayKey, data: { items }, path: '/', inApp: { type: 'CELEBRATIONS', title: `Today's celebrations: ${items.length}`, body: items.map((x) => x.name).join(', ') } });
    }
  }
}

async function sendHolidayReminders(now = new Date()) {
  const tomorrow = istTodayKey(new Date(now.getTime() + 86400000));
  for (const tenant of await activeTenants()) {
    const holidays = (await Holiday.find({ tenantId: tenant._id, date: { $gte: new Date(Date.now() - 86400000), $lte: new Date(Date.now() + 3 * 86400000) } }).lean())
      .filter((h) => holidayDateKey(h) === tomorrow && !h.optional);
    for (const h of holidays) {
      const q = { tenantId: tenant._id, status: { $ne: 'OFFBOARDED' } };
      if (h.location && h.location !== 'ALL') q.workLocation = { $in: [h.location, 'BOTH'] };
      const people = await Employee.find(q).select('_id firstName lastName userId email phone').lean();
      await notify({ tenantId: tenant._id, event: 'HOLIDAY_REMINDER', recipients: people.map((p) => ({ employee: p, employeeId: p._id })), entityId: `${h._id}:${tomorrow}`, data: { holidayName: h.name, date: tomorrow }, path: '/holidays', inApp: { type: 'HOLIDAY', title: `Tomorrow is a holiday: ${h.name}`, body: 'Plan hand-overs and approvals today.' } });
    }
  }
}

async function sendDailyDigest(now = new Date()) {
  const todayKey = istTodayKey(now);
  for (const tenant of await activeTenants()) {
    const window = dayWindow(todayKey);
    const [people, rows, pendingLeaves, pendingRegs, onLeave] = await Promise.all([
      Employee.countDocuments({ tenantId: tenant._id, status: { $ne: 'OFFBOARDED' } }),
      Attendance.find({ tenantId: tenant._id, date: window }).select('status lateMinutes checkIn').lean(),
      LeaveRequest.countDocuments({ tenantId: tenant._id, status: 'PENDING' }),
      Regularization.countDocuments({ tenantId: tenant._id, status: 'PENDING' }),
      LeaveRequest.countDocuments({ tenantId: tenant._id, status: 'APPROVED', fromDate: { $lte: window.$lte }, toDate: { $gte: window.$gte } })
    ]);
    const checkedIn = rows.filter((r) => r.checkIn).length;
    const late = rows.filter((r) => Number(r.lateMinutes) > 0).length;
    const facts = { date: todayKey, activeEmployees: people, checkedInBy10am: checkedIn, lateArrivals: late, onApprovedLeave: onLeave, pendingLeaveRequests: pendingLeaves, pendingAttendanceCorrections: pendingRegs };
    const summary = (await dailyDigestText({ tenantId: tenant._id, facts })) || `${checkedIn} of ${people} employees have checked in (${late} late). ${onLeave} on leave. ${pendingLeaves} leave and ${pendingRegs} attendance requests are pending.`;
    await notify({
      tenantId: tenant._id,
      event: 'DAILY_HR_DIGEST',
      recipients: await recipientsForRoles(tenant._id, ['SUPER_ADMIN', 'HR_ADMIN']),
      entityId: todayKey,
      path: '/dashboard',
      data: { date: todayKey, summary, rows: [['Checked in', `${checkedIn} / ${people}`], ['Late arrivals', late], ['On leave', onLeave], ['Pending leave requests', pendingLeaves], ['Pending attendance corrections', pendingRegs]] },
      inApp: { type: 'DAILY_DIGEST', title: `HR digest · ${todayKey}`, body: summary.slice(0, 280) }
    });
  }
}

async function sendMissingCheckInAlerts(now = new Date()) {
  const todayKey = istTodayKey(now);
  const dow = new Date(`${todayKey}T00:00:00Z`).getUTCDay();
  if (dow === 0) return;
  for (const tenant of await activeTenants()) {
    const holidays = (await Holiday.find({ tenantId: tenant._id, date: { $gte: new Date(Date.now() - 2 * 86400000), $lte: new Date(Date.now() + 2 * 86400000) } }).lean()).filter((h) => holidayDateKey(h) === todayKey);
    if (holidays.length) continue;
    const window = dayWindow(todayKey);
    // Office staff only: plant shifts start at different times, including nights.
    const staff = await Employee.find({ tenantId: tenant._id, status: { $ne: 'OFFBOARDED' }, workLocation: 'OFFICE' }).select('_id firstName lastName userId email phone').lean();
    const ids = staff.map((s) => s._id);
    const [punched, onLeave] = await Promise.all([
      Attendance.find({ tenantId: tenant._id, employeeId: { $in: ids }, date: window }).select('employeeId').lean(),
      LeaveRequest.find({ tenantId: tenant._id, employeeId: { $in: ids }, status: 'APPROVED', fromDate: { $lte: window.$lte }, toDate: { $gte: window.$gte } }).select('employeeId').lean()
    ]);
    const skip = new Set([...punched, ...onLeave].map((r) => String(r.employeeId)));
    // Respect each person's own shift: a weekly off, or a shift that has not
    // started (plus an hour's grace) yet, is not a missing check-in.
    const day = new Date(`${todayKey}T00:00:00.000Z`);
    const [assignments, defaultShift] = await Promise.all([
      ShiftAssignment.find({ tenantId: tenant._id, employeeId: { $in: ids }, fromDate: { $lte: day }, $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: day } }] }).populate('shiftId').sort('fromDate createdAt').lean(),
      Shift.findOne({ tenantId: tenant._id, active: true }).sort('createdAt').lean()
    ]);
    const shiftBy = new Map();
    for (const a of assignments) if (a.shiftId && assignmentAppliesOnWeekday(a, day)) shiftBy.set(String(a.employeeId), a.shiftId);
    const missing = staff.filter((s) => {
      if (skip.has(String(s._id))) return false;
      const shift = shiftBy.get(String(s._id)) || defaultShift;
      const offDays = Array.isArray(shift?.weeklyOffDays) && shift.weeklyOffDays.length ? shift.weeklyOffDays : [0];
      if (offDays.includes(dow)) return false;
      if (shift) {
        const window = computeShiftWindow(shift, day, Number(process.env.HRMS_TIMEZONE_OFFSET_MINUTES || 330));
        if (now < new Date(window.start.getTime() + 60 * 60000)) return false;
      }
      return true;
    });
    if (missing.length) await notify({ tenantId: tenant._id, event: 'ATTENDANCE_MISSING', recipients: missing.map((p) => ({ employee: p, employeeId: p._id })), entityId: todayKey, path: '/attendance', data: { date: todayKey }, inApp: { type: 'ATTENDANCE_MISSING', title: 'No check-in recorded today', body: 'If you are working today, mark attendance or raise a regularization.' } });
  }
}

function startSchedulers() {
  // Close forgotten punches every hour. Without this a duty day only closes when
  // the employee next opens the app, and payroll would meanwhile see an open row.
  job('autoClose', '15 * * * *', async () => {
    const { autoCloseStalePunches } = require('../services/attendanceAutoCloseService');
    for (const tenant of await Tenant.find({}, '_id')) {
      const r = await autoCloseStalePunches({ tenantId: tenant._id });
      if (r.closed) console.log(`[autoClose] tenant ${tenant._id}: closed ${r.closed} open punch(es)`);
    }
  });

  // ESSL / ZKTeco biometric attendance sync every 5 minutes for all enabled devices.
  job('biometricSync', '*/5 * * * *', () => syncAllDevices());
  // Machines that push by themselves: add any punch left waiting by a restart.
  job('machinePunchCatchUp', '*/2 * * * *', () => addWaitingMachinePunches());

  // Monthly leave accrual at 00:10 on day 1 (company time).
  job('leaveAccrual', '10 0 1 * *', async () => {
    for (const tenant of await activeTenants()) await accrueMonthlyLeavesForTenant(tenant._id, new Date());
  });

  job('probationReminders', '5 9 * * *', () => runProbationReminders(new Date()));

  // Month-end payroll checkpoint (in-app, so it works without email/WhatsApp).
  job('payrollReminder', '0 9 25 * *', async () => {
    const month = istTodayKey().slice(0, 7);
    for (const tenant of await activeTenants()) {
      await notifyRoles({
        tenantId: tenant._id,
        roles: ['SUPER_ADMIN', 'HR_ADMIN'],
        type: 'PAYROLL_REMINDER',
        title: `Payroll checkpoint · ${month}`,
        body: 'Month-end payroll is approaching. Review attendance exceptions, approved LOP and salary structures before generating payroll.',
        link: '/payroll',
        priority: 'HIGH'
      });
    }
  });

  // Birthday & work-anniversary wishes. v25 sent this to an empty address, so
  // nobody ever received it.
  job('celebrations', '30 8 * * *', () => sendCelebrations(new Date()));
  job('dailyDigest', '45 10 * * 1-6', () => sendDailyDigest(new Date()));
  job('missingCheckIn', '30 11 * * 1-6', () => sendMissingCheckInAlerts(new Date()));
  job('holidayReminder', '0 17 * * *', () => sendHolidayReminders(new Date()));
}

module.exports = { startSchedulers, sendCelebrations, sendHolidayReminders, sendDailyDigest, sendMissingCheckInAlerts };

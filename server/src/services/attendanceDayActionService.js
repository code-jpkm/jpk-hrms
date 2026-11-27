/**
 * Everything HR / admin can do to one day straight from the attendance calendar,
 * without visiting the Requests, Leave or Shifts screens:
 *
 *   SET_TIMES         fix the in / out time (saved as an approved correction)
 *   MARK              count the day as present, half day or absent
 *   REMOVE_LOP        keep the day as it is but take away its loss of pay
 *   UNDO              remove an HR change; the day is calculated from punches again
 *   SHIFT             change the shift for this day only, or from this day onwards
 *   ADD_LEAVE         record leave (or WFH) for the day
 *   LEAVE_DECISION    approve / reject the leave request waiting on this day
 *   REQUEST_DECISION  approve / reject the correction request waiting on this day
 *
 * Each action reuses the same code path as its own screen (same checks, same
 * audit trail, same notifications). Afterwards the employee's month is evaluated
 * again and the payroll draft follows (attendanceChangeService). The response
 * carries the refreshed day so the calendar updates in place.
 */
const ApiError = require('../utils/apiError');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Shift = require('../models/Shift');
const ShiftAssignment = require('../models/ShiftAssignment');
const RuleAudit = require('../models/RuleAudit');
const { hasAbility } = require('../middleware/auth');
const { startOfDay, companyToday, dateKey } = require('../utils/date');
const { getScopedEmployeeIds } = require('./scopeService');
const { settleAttendanceChange, withPayrollNote } = require('./attendanceChangeService');

const ACTIONS = ['SET_TIMES', 'MARK', 'REMOVE_LOP', 'UNDO', 'SHIFT', 'ADD_LEAVE', 'LEAVE_DECISION', 'REQUEST_DECISION'];
const MARKS = {
  PRESENT: { lop: 0, label: 'present (full day)' },
  HALF_DAY: { lop: 0.5, label: 'half day' },
  ABSENT: { lop: 1, label: 'absent' }
};

/** Same rule as the route guards: Super Admin always, listed roles, or the ability itself. */
function assertAbility(req, moduleName, action, ...roles) {
  const role = req.user?.role;
  if (role === 'SUPER_ADMIN' || roles.includes(role) || hasAbility(req.user, moduleName, action)) return;
  throw new ApiError(403, `Missing permission: ${moduleName}:${action}`);
}

function requiredReason(value, fallback) {
  const text = String(value || '').trim();
  if (text.length >= 3) return text.slice(0, 500);
  if (fallback) return fallback;
  throw new ApiError(400, 'Give a short reason (it is saved in the audit log)');
}

function whoIs(req) {
  return req.user?.name || ({ SUPER_ADMIN: 'Super Admin', HR_ADMIN: 'HR' }[req.user?.role]) || 'HR';
}

/** Keeps what the day was before the first HR change, so UNDO can put it back. */
function rememberBeforeHr(record) {
  if (record.isNew || record.meta?.beforeHr) return;
  record.meta = { ...(record.meta || {}), beforeHr: { source: record.source, status: record.status, dayPart: record.dayPart, at: new Date() } };
  record.markModified('meta');
}

function monthsFrom(day, until = companyToday(), cap = 12) {
  const months = [];
  const cursor = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  const last = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), 1));
  while (cursor <= last && months.length < cap) {
    months.push(dateKey(cursor).slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months.length ? months : [dateKey(day).slice(0, 7)];
}

async function audit(req, action, record, before, reason) {
  await RuleAudit.create({
    tenantId: req.tenantId,
    module: 'ATTENDANCE',
    action,
    targetId: String(record?._id || ''),
    before,
    after: record?.toObject ? record.toObject() : record,
    reason,
    changedBy: req.user._id
  });
}

async function runDayAction(req, body = {}) {
  const action = String(body.action || '').toUpperCase();
  if (!ACTIONS.includes(action)) throw new ApiError(400, `Unknown action. Use one of: ${ACTIONS.join(', ')}`);
  const dayKey = String(body.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new ApiError(400, 'date must be YYYY-MM-DD');
  if (!body.employeeId) throw new ApiError(400, 'employeeId is required');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  if (!allowed.includes(String(body.employeeId))) throw new ApiError(403, 'This employee is outside your Office / Factory scope');
  const employee = await Employee.findOne({ _id: body.employeeId, tenantId: req.tenantId });
  if (!employee) throw new ApiError(404, 'Employee not found');

  const employeeId = employee._id;
  const day = startOfDay(new Date(`${dayKey}T00:00:00.000Z`));
  const isFuture = day > companyToday();
  if (isFuture && !['SHIFT', 'ADD_LEAVE', 'LEAVE_DECISION'].includes(action)) {
    throw new ApiError(400, 'This day has not happened yet');
  }
  const isSelf = Boolean(req.employee && String(req.employee._id) === String(employeeId));
  const onBehalf = isSelf ? undefined : String(employeeId);
  const who = whoIs(req);

  let message = '';
  let dates = [day];
  let months = [];
  let changed = true;

  switch (action) {
    case 'SET_TIMES': {
      // The same path as a correction recorded by an approver: it is approved at
      // once, kept in the requests history, and the employee is told.
      const { submitRegularization } = require('../controllers/regularizationController');
      if (!body.checkIn && !body.checkOut) throw new ApiError(400, 'Choose the in time, the out time, or both');
      const { autoApproved } = await submitRegularization(req, {
        employeeId: onBehalf,
        date: dayKey,
        requestedCheckIn: body.checkIn || undefined,
        requestedCheckOut: body.checkOut || undefined,
        reason: requiredReason(body.reason, `Time corrected from the attendance calendar by ${who}`),
        requestType: 'ATTENDANCE_CORRECTION'
      });
      changed = autoApproved;
      if (autoApproved) {
        // The day is now calculated from the corrected times, so an earlier HR
        // decision pinned on it (present / half / absent, LOP removed) no longer applies.
        const record = await Attendance.findOne({ tenantId: req.tenantId, employeeId, date: day });
        if (record && record.status !== 'LEAVE' && record.lopOverride?.enabled) {
          record.lopOverride = { enabled: false };
          if (record.meta?.beforeHr) {
            const meta = { ...record.meta };
            delete meta.beforeHr;
            record.meta = meta;
            record.markModified('meta');
          }
          await record.save();
        }
      }
      message = autoApproved ? 'In / out time saved.' : 'Correction sent to your approver.';
      break;
    }

    case 'MARK': {
      assertAbility(req, 'ATTENDANCE', 'OVERRIDE', 'HR_ADMIN');
      const status = String(body.status || '').toUpperCase();
      const mark = MARKS[status];
      if (!mark) throw new ApiError(400, 'status must be PRESENT, HALF_DAY or ABSENT');
      const reason = requiredReason(body.reason, `Marked ${mark.label} from the attendance calendar by ${who}`);
      let record = await Attendance.findOne({ tenantId: req.tenantId, employeeId, date: day });
      if (record && ['LEAVE', 'WFH', 'HOLIDAY'].includes(record.status)) {
        throw new ApiError(400, `This day is recorded as ${record.status.replace('_', ' ').toLowerCase()}. Cancel that first, then mark the day.`);
      }
      const before = record ? record.toObject() : null;
      if (!record) record = new Attendance({ tenantId: req.tenantId, employeeId, date: day, source: 'OVERRIDE' });
      rememberBeforeHr(record);
      record.status = status;
      record.dayPart = 'FULL';
      record.source = 'OVERRIDE';
      record.needsReview = false;
      record.lopOverride = { enabled: true, originalLopDays: Number(record.lopDays || 0), overrideLopDays: mark.lop, reason, category: 'MANAGEMENT_APPROVAL', overriddenBy: req.user._id, overriddenAt: new Date() };
      record.lopDays = mark.lop;
      record.overrideRemarks = reason;
      record.overrideBy = req.user._id;
      record.deductionReason = `Marked ${mark.label} by ${who}: ${reason}`;
      await record.save();
      await audit(req, 'ATTENDANCE_DAY_MARKED', record, before, reason);
      message = `Marked ${mark.label}${mark.lop ? ` (${mark.lop} day LOP)` : ', no loss of pay'}.`;
      break;
    }

    case 'REMOVE_LOP': {
      assertAbility(req, 'ATTENDANCE', 'OVERRIDE', 'HR_ADMIN');
      const reason = requiredReason(body.reason);
      let record = await Attendance.findOne({ tenantId: req.tenantId, employeeId, date: day });
      const before = record ? record.toObject() : null;
      // An absent day often has no attendance row at all; it needs one to carry "no LOP".
      if (!record) record = new Attendance({ tenantId: req.tenantId, employeeId, date: day, status: 'ABSENT', source: 'OVERRIDE', lopDays: 1 });
      rememberBeforeHr(record);
      record.lopOverride = { enabled: true, originalLopDays: Number(record.lopDays || 0), overrideLopDays: 0, reason, category: ['MEDICAL', 'SPECIAL', 'MANAGEMENT_APPROVAL', 'SYSTEM_CORRECTION', 'OTHER'].includes(body.category) ? body.category : 'SPECIAL', overriddenBy: req.user._id, overriddenAt: new Date() };
      record.lopDays = 0;
      record.overrideRemarks = reason;
      record.overrideBy = req.user._id;
      record.deductionReason = `LOP removed by ${who}: ${reason}`;
      await record.save();
      await audit(req, 'LOP_REMOVED', record, before, reason);
      message = 'Loss of pay removed for this day.';
      break;
    }

    case 'UNDO': {
      assertAbility(req, 'ATTENDANCE', 'OVERRIDE', 'HR_ADMIN');
      const record = await Attendance.findOne({ tenantId: req.tenantId, employeeId, date: day });
      if (!record) throw new ApiError(404, 'There is no HR change on this day to undo');
      if (record.status === 'LEAVE') throw new ApiError(400, 'This day is leave. Cancel the leave from the Leave screen instead.');
      const original = record.meta?.beforeHr;
      if (!record.lopOverride?.enabled && !original) throw new ApiError(400, 'There is no HR change on this day to undo');
      const before = record.toObject();
      const reason = requiredReason(body.reason, `HR change undone from the attendance calendar by ${who}`);
      if (!original && record.source === 'OVERRIDE' && !record.checkIn && !record.checkOut) {
        // The row only existed because of the HR change: without it the day is as before.
        await record.deleteOne();
        await audit(req, 'ATTENDANCE_HR_CHANGE_UNDONE', { _id: record._id, deleted: true }, before, reason);
      } else {
        if (original) {
          record.source = original.source || record.source;
          record.status = original.status || record.status;
          record.dayPart = original.dayPart || record.dayPart;
          const meta = { ...(record.meta || {}) };
          delete meta.beforeHr;
          record.meta = meta;
          record.markModified('meta');
        }
        record.lopOverride = { enabled: false };
        record.overrideRemarks = undefined;
        record.overrideBy = undefined;
        record.deductionReason = '';
        await record.save();
        await audit(req, 'ATTENDANCE_HR_CHANGE_UNDONE', record, before, reason);
      }
      message = 'HR change removed. The day is calculated from the punches again.';
      break;
    }

    case 'SHIFT': {
      assertAbility(req, 'SHIFTS', 'MANAGE', 'HR_ADMIN');
      const shift = await Shift.findOne({ _id: body.shiftId, tenantId: req.tenantId });
      if (!shift) throw new ApiError(404, 'Choose a shift');
      const onwards = String(body.scope || '').toUpperCase() === 'ONWARDS';
      const range = { fromDate: day, toDate: onwards ? null : day };
      const { upsertShiftAssignment } = require('./shiftAssignmentService');
      const assignment = await upsertShiftAssignment({ tenantId: req.tenantId, employeeId, shiftId: shift._id, fromDate: range.fromDate, toDate: range.toDate, assignedBy: req.user._id });
      await audit(req, 'SHIFT_CHANGED_FROM_CALENDAR', assignment, null, `${shift.name} ${onwards ? 'from' : 'on'} ${dayKey}`);
      months = onwards ? monthsFrom(day) : [dayKey.slice(0, 7)];
      message = onwards ? `${shift.name} applies from this day onwards.` : `Shift for this day set to ${shift.name}.`;
      break;
    }

    case 'ADD_LEAVE': {
      const { submitLeaveRequest } = require('../controllers/leaveController');
      const leaveType = String(body.leaveType || '').toUpperCase();
      if (!leaveType) throw new ApiError(400, 'Choose the leave type');
      const { autoApproved, label } = await submitLeaveRequest(req, {
        employeeId: onBehalf,
        requestType: leaveType === 'WFH' ? 'WFH' : 'LEAVE',
        leaveType,
        fromDate: dayKey,
        toDate: dayKey,
        dayPart: ['FIRST_HALF', 'SECOND_HALF'].includes(body.dayPart) ? body.dayPart : 'FULL',
        reason: requiredReason(body.reason, `Recorded from the attendance calendar by ${who}`)
      });
      changed = autoApproved;
      message = autoApproved ? `${label} recorded for this day.` : `${label} request sent for approval.`;
      break;
    }

    case 'LEAVE_DECISION': {
      assertAbility(req, 'LEAVE', 'APPROVE', 'HR_ADMIN', 'MANAGER');
      const { decideLeaveRequest } = require('../controllers/leaveController');
      const decision = String(body.decision || '').toUpperCase();
      const { request } = await decideLeaveRequest(req, body.requestId, { status: decision, remarks: body.remarks });
      dates = [request.fromDate, request.toDate];
      changed = request.status === 'APPROVED';
      message = changed ? 'Leave approved.' : 'Leave rejected.';
      break;
    }

    case 'REQUEST_DECISION': {
      const { decideRegularization } = require('../controllers/regularizationController');
      const decision = String(body.decision || '').toUpperCase();
      const result = await decideRegularization(req, body.requestId, { status: decision, remarks: body.remarks });
      dates = [result.date || day];
      changed = result.approved;
      message = changed ? 'Correction approved.' : 'Correction rejected.';
      break;
    }

    default:
      break;
  }

  const settled = changed
    ? await settleAttendanceChange(req, { employeeIds: [employeeId], dates, months })
    : { payroll: [], payrollNote: '' };

  const { buildCalendar } = require('./attendanceCalendarService');
  const calendar = await buildCalendar({ tenantId: req.tenantId, employeeId, month: dayKey.slice(0, 7), selfHeal: false });
  return {
    message: withPayrollNote(message, settled.payrollNote),
    day: calendar.days.find((d) => d.date === dayKey) || null,
    summary: calendar.summary,
    payroll: settled.payroll
  };
}

module.exports = { runDayAction, ACTIONS };

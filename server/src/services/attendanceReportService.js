/**
 * Attendance reports for HR, as Excel and PDF:
 *   - the month for everyone (one row per person, one column per day, totals),
 *     with every day's in / out time and phone location in the Excel file;
 *   - who left before their shift ended (more than N minutes, at least M times),
 *     with each day: shift end, actual out time and minutes early.
 *
 * Everything is read in one go for all the people in scope (one query per
 * collection) and worked out in memory: the server is far from the database, so
 * building each person's calendar separately would take minutes.
 */
const PDFDocument = require('pdfkit');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Holiday = require('../models/Holiday');
const LeaveRequest = require('../models/LeaveRequest');
const PermissionRequest = require('../models/PermissionRequest');
const Regularization = require('../models/Regularization');
const Shift = require('../models/Shift');
const ShiftAssignment = require('../models/ShiftAssignment');
const Tenant = require('../models/Tenant');
const ApiError = require('../utils/apiError');
const { startOfDay, endOfDay, monthRange, eachDate, dateKey, holidayDateKey, holidayAppliesTo, companyToday, formatCompanyTime } = require('../utils/date');
const { computeShiftWindow, minutesBetween, resolveTimezoneOffset } = require('../utils/shift');
const { getPolicy } = require('./attendanceRulesService');
const { punchLocations, locationLabel } = require('../utils/punchLocation');
const { workbookBuffer, columnLetter } = require('../utils/xlsxWriter');

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLACES = { ALL: 'Office and factory', OFFICE: 'Office', FACTORY: 'Factory' };
const WORK_PLACE = { OFFICE: 'Office', FACTORY: 'Factory', BOTH: 'Office and factory' };
const workPlace = (value) => WORK_PLACE[value] || value || '';

/** What each day shows in the month grid. */
const CODES = {
  PRESENT: 'P',
  REVIEW: 'P?',
  HALF_DAY: 'HD',
  ABSENT: 'A',
  LEAVE: 'L',
  LEAVE_HALF: 'L½',
  WFH: 'WFH',
  HOLIDAY: 'H',
  HOLIDAY_WORKED: 'H/P',
  WEEK_OFF: 'WO',
  WEEK_OFF_WORKED: 'WO/P',
  IN_PROGRESS: 'IN',
  NOT_MARKED: '·',
  UPCOMING: '',
  NOT_JOINED: ''
};

const LEGEND = [
  ['P', 'Present'],
  ['P?', 'Present, out time missing (HR to decide)'],
  ['HD', 'Half day'],
  ['A', 'Absent'],
  ['L', 'Leave'],
  ['L½', 'Half-day leave'],
  ['WFH', 'Work from home'],
  ['H', 'Holiday'],
  ['H/P', 'Worked on a holiday'],
  ['WO', 'Weekly off'],
  ['WO/P', 'Worked on the weekly off'],
  ['IN', 'On duty now'],
  ['·', 'Not marked yet (today)']
];

const STATUS_WORDS = {
  PRESENT: 'Present', REVIEW: 'Out time missing', HALF_DAY: 'Half day', ABSENT: 'Absent', LEAVE: 'Leave', LEAVE_HALF: 'Half-day leave',
  WFH: 'Work from home', HOLIDAY: 'Holiday', HOLIDAY_WORKED: 'Worked on a holiday', WEEK_OFF: 'Weekly off', WEEK_OFF_WORKED: 'Worked on the weekly off',
  IN_PROGRESS: 'On duty now', NOT_MARKED: 'Not marked yet', UPCOMING: '', NOT_JOINED: 'Before joining'
};

function monthTitle(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function placeOf(value) {
  const key = String(value || 'ALL').toUpperCase();
  return PLACES[key] ? key : 'ALL';
}

function checkMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw new ApiError(400, 'month must be YYYY-MM');
  return month;
}

/** h:mm from minutes ("8:47"). */
function hoursLabel(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** "12 min 30 s" */
function earlyLabel(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return sec ? `${min} min ${sec} s` : `${min} min`;
}

function personName(e) {
  return `${e.firstName || ''} ${e.lastName || ''}`.trim();
}

/** The last assignment covering the day wins (same rule as the calendar and payroll). */
function shiftOn(assignments, dayStart, defaultShift, from, to) {
  const assignment = [...assignments].reverse().find((a) => {
    const aFrom = a.fromDate ? startOfDay(a.fromDate) : from;
    const aTo = a.toDate ? endOfDay(a.toDate) : to;
    return dayStart >= aFrom && dayStart <= aTo;
  });
  return assignment?.shiftId || defaultShift || null;
}

function weeklyOffOn(shift, dayStart) {
  const days = Array.isArray(shift?.weeklyOffDays) && shift.weeklyOffDays.length ? shift.weeklyOffDays : [0];
  return days.includes(dayStart.getDay());
}

/** Everything both reports need for one month and the people in scope. */
async function loadMonth({ tenantId, employeeIds, month, location }) {
  const { from, to } = monthRange(month);
  const place = placeOf(location);
  const query = { tenantId, _id: { $in: employeeIds } };
  if (place !== 'ALL') query.workLocation = { $in: [place, 'BOTH'] };
  const people = await Employee.find(query)
    .select('employeeCode firstName lastName department designation workLocation dateOfJoining status')
    .lean();
  const joined = people.filter((e) => !(e.dateOfJoining && startOfDay(e.dateOfJoining) > to));
  const ids = joined.map((e) => e._id);
  const [policy, tenant, records, assignments, defaultShift, holidays, leaves, permissions, regularizations] = await Promise.all([
    getPolicy(tenantId),
    Tenant.findById(tenantId).select('name').lean(),
    Attendance.find({ tenantId, employeeId: { $in: ids }, date: { $gte: from, $lte: to } }).lean(),
    ShiftAssignment.find({
      tenantId,
      employeeId: { $in: ids },
      fromDate: { $lte: to },
      $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: from } }]
    }).populate('shiftId').sort('fromDate createdAt').lean(),
    Shift.findOne({ tenantId, active: true }).sort('createdAt').lean(),
    // Widened by a day: older holiday rows were saved at India midnight.
    Holiday.find({ tenantId, date: { $gte: new Date(from.getTime() - 86400000), $lte: new Date(to.getTime() + 86400000) } }).lean(),
    LeaveRequest.find({ tenantId, employeeId: { $in: ids }, status: 'APPROVED', fromDate: { $lte: to }, toDate: { $gte: from } }).select('employeeId requestType leaveType fromDate toDate dayPart').lean(),
    PermissionRequest.find({ tenantId, employeeId: { $in: ids }, status: 'APPROVED', type: 'EARLY_LEAVE', date: { $gte: from, $lte: to } }).select('employeeId date').lean(),
    Regularization.find({ tenantId, employeeId: { $in: ids }, status: 'APPROVED', requestType: 'EARLY_LEAVE', date: { $gte: from, $lte: to } }).select('employeeId date').lean()
  ]);

  const recordsBy = new Map();
  for (const r of records) {
    const key = String(r.employeeId);
    if (!recordsBy.has(key)) recordsBy.set(key, new Map());
    recordsBy.get(key).set(dateKey(startOfDay(r.date)), r);
  }
  const assignmentsBy = new Map();
  for (const a of assignments) {
    const key = String(a.employeeId);
    if (!assignmentsBy.has(key)) assignmentsBy.set(key, []);
    assignmentsBy.get(key).push(a);
  }
  const leavesBy = new Map();
  for (const l of leaves) {
    const key = String(l.employeeId);
    if (!leavesBy.has(key)) leavesBy.set(key, []);
    leavesBy.get(key).push(l);
  }
  const permitted = new Set([...permissions, ...regularizations].map((p) => `${p.employeeId}:${dateKey(startOfDay(p.date))}`));
  const monthHolidays = holidays
    .filter((h) => !h.optional)
    .map((h) => ({ ...h, key: holidayDateKey(h) }))
    .filter((h) => h.key.startsWith(month));

  // Leave people out only if they left and have nothing this month.
  const employees = joined
    .filter((e) => e.status !== 'OFFBOARDED' || recordsBy.has(String(e._id)))
    .sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode), 'en', { numeric: true }));

  return {
    month,
    from,
    to,
    place,
    tenantName: tenant?.name || '',
    offset: resolveTimezoneOffset(policy),
    employees,
    recordsBy,
    assignmentsBy,
    leavesBy,
    permitted,
    holidays: monthHolidays,
    defaultShift,
    days: eachDate(from, to).map((d) => startOfDay(d))
  };
}

function holidayFor(data, employee, key) {
  return data.holidays.find((h) => h.key === key && holidayAppliesTo(h, employee.workLocation)) || null;
}

/** One person's day as the month report shows it. */
function resolveDay(data, employee, dayStart, today) {
  const key = dateKey(dayStart);
  const record = data.recordsBy.get(String(employee._id))?.get(key) || null;
  const assignments = data.assignmentsBy.get(String(employee._id)) || [];
  const shift = shiftOn(assignments, dayStart, data.defaultShift, data.from, data.to);
  const holiday = holidayFor(data, employee, key);
  const weeklyOff = weeklyOffOn(shift, dayStart);
  const joinDay = employee.dateOfJoining ? startOfDay(employee.dateOfJoining) : null;
  const isToday = dayStart.getTime() === today.getTime();
  const isFuture = dayStart > today;
  let status;
  if (!record) {
    if (joinDay && dayStart < joinDay) status = 'NOT_JOINED';
    else if (holiday) status = 'HOLIDAY';
    else if (weeklyOff) status = 'WEEK_OFF';
    else if (isFuture) status = 'UPCOMING';
    else if (isToday) status = 'NOT_MARKED';
    else status = 'ABSENT';
  } else {
    status = record.status || 'PRESENT';
    if (record.checkIn && !record.checkOut && !record.autoClosed && isToday) status = 'IN_PROGRESS';
    else if (record.needsReview) status = 'REVIEW';
    if (['PRESENT', 'REVIEW'].includes(status) && record.checkIn && holiday) status = 'HOLIDAY_WORKED';
    else if (['PRESENT', 'REVIEW'].includes(status) && record.checkIn && weeklyOff && !holiday) status = 'WEEK_OFF_WORKED';
    if (status === 'LEAVE' && record.dayPart && record.dayPart !== 'FULL') status = 'LEAVE_HALF';
  }
  const lopDays = record ? Number(record.lopDays || 0) : (status === 'ABSENT' ? 1 : 0);
  const workedMinutes = record?.checkIn && record?.checkOut ? minutesBetween(record.checkIn, record.checkOut) : 0;
  return {
    key,
    dayStart,
    record,
    shift,
    holiday,
    status,
    code: CODES[status] ?? '',
    lopDays,
    workedMinutes,
    lateMinutes: Number(record?.lateMinutes || 0),
    earlyLeaveMinutes: Number(record?.earlyLeaveMinutes || 0),
    places: punchLocations(record)
  };
}

/** The month for everyone: day codes, totals and each day's details. */
async function monthlyReport({ tenantId, employeeIds, month, location }) {
  checkMonth(month);
  const data = await loadMonth({ tenantId, employeeIds, month, location });
  const today = companyToday();
  const rows = data.employees.map((employee) => {
    const days = data.days.map((d) => resolveDay(data, employee, d, today));
    const totals = { present: 0, halfDays: 0, absent: 0, leaveDays: 0, wfh: 0, holidays: 0, weekOffs: 0, lateDays: 0, earlyDays: 0, reviewDays: 0, lopDays: 0, workedMinutes: 0 };
    for (const day of days) {
      if (['PRESENT', 'REVIEW', 'HOLIDAY_WORKED', 'WEEK_OFF_WORKED', 'IN_PROGRESS'].includes(day.status)) totals.present += 1;
      if (day.status === 'HALF_DAY') totals.halfDays += 1;
      if (day.status === 'ABSENT') totals.absent += 1;
      if (day.status === 'LEAVE') totals.leaveDays += 1;
      if (day.status === 'LEAVE_HALF') totals.leaveDays += 0.5;
      if (day.status === 'WFH') totals.wfh += 1;
      if (['HOLIDAY', 'HOLIDAY_WORKED'].includes(day.status)) totals.holidays += 1;
      if (['WEEK_OFF', 'WEEK_OFF_WORKED'].includes(day.status)) totals.weekOffs += 1;
      if (day.status === 'REVIEW') totals.reviewDays += 1;
      if (day.lateMinutes > 0) totals.lateDays += 1;
      if (day.earlyLeaveMinutes > 0) totals.earlyDays += 1;
      totals.lopDays += day.lopDays;
      totals.workedMinutes += day.workedMinutes;
    }
    totals.lopDays = Math.round(totals.lopDays * 100) / 100;
    return { employee, days, totals };
  });
  return { ...data, today, rows };
}

/** People who left more than `minMinutes` before their shift ended, at least `minTimes` times. */
async function earlyLeaveReport({ tenantId, employeeIds, month, location, minMinutes = 5, minTimes = 3 }) {
  checkMonth(month);
  const min = Math.max(0, Math.min(600, Number(minMinutes) || 0));
  const times = Math.max(1, Math.min(31, Math.round(Number(minTimes) || 1)));
  const data = await loadMonth({ tenantId, employeeIds, month, location });
  const people = [];
  for (const employee of data.employees) {
    const records = [...(data.recordsBy.get(String(employee._id))?.values() || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    const assignments = data.assignmentsBy.get(String(employee._id)) || [];
    const days = [];
    for (const record of records) {
      // Only working days with both punches: no leave, WFH, holiday or weekly off.
      if (!record.checkIn || !record.checkOut || record.needsReview) continue;
      if (!['PRESENT', 'HALF_DAY'].includes(record.status)) continue;
      const dayStart = startOfDay(record.date);
      const key = dateKey(dayStart);
      if (holidayFor(data, employee, key)) continue;
      const shift = shiftOn(assignments, dayStart, data.defaultShift, data.from, data.to);
      if (!shift || weeklyOffOn(shift, dayStart)) continue;
      const window = computeShiftWindow(shift, dayStart, data.offset);
      const secondsEarly = Math.floor((window.end.getTime() - new Date(record.checkOut).getTime()) / 1000);
      if (secondsEarly <= min * 60) continue;
      days.push({
        key,
        weekday: WEEKDAY[dayStart.getDay()],
        shiftName: shift.name || '',
        shiftEnd: window.end,
        checkIn: record.checkIn,
        checkOut: record.checkOut,
        secondsEarly,
        minutesEarly: Math.round(secondsEarly / 6) / 10,
        permission: data.permitted.has(`${employee._id}:${key}`),
        status: record.status
      });
    }
    if (days.length >= times) {
      const totalSeconds = days.reduce((t, d) => t + d.secondsEarly, 0);
      const most = days.reduce((a, b) => (b.secondsEarly > a.secondsEarly ? b : a), days[0]);
      people.push({ employee, days, count: days.length, totalSeconds, averageSeconds: totalSeconds / days.length, most });
    }
  }
  people.sort((a, b) => b.count - a.count || b.totalSeconds - a.totalSeconds || String(a.employee.employeeCode).localeCompare(String(b.employee.employeeCode), 'en', { numeric: true }));
  return { ...data, minMinutes: min, minTimes: times, people };
}

/* ------------------------------------------------------------------ Excel */

function title(report, what) {
  return `${what} · ${monthTitle(report.month)} · ${PLACES[report.place]}`;
}

function generatedLine(report) {
  const at = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${report.tenantName ? `${report.tenantName} · ` : ''}Made ${at}`;
}

function monthlyReportXlsx(report) {
  const dayHeads = report.days.map((d) => `${d.getDate()} ${WEEKDAY[d.getDay()]}`);
  const totalHeads = ['Present', 'Half day', 'Absent', 'Leave', 'WFH', 'Holiday', 'Weekly off', 'Late (days)', 'Left early (days)', 'Out time missing', 'LOP days', 'Hours worked'];
  const head = ['Code', 'Name', 'Department', 'Location', ...dayHeads, ...totalHeads];
  const muster = [
    [title(report, 'Attendance report')],
    [generatedLine(report)],
    [],
    head,
    ...report.rows.map(({ employee, days, totals }) => [
      employee.employeeCode, personName(employee), employee.department || '', workPlace(employee.workLocation),
      ...days.map((d) => d.code),
      totals.present, totals.halfDays, totals.absent, totals.leaveDays, totals.wfh, totals.holidays, totals.weekOffs,
      totals.lateDays, totals.earlyDays, totals.reviewDays, totals.lopDays, hoursLabel(totals.workedMinutes)
    ]),
    [],
    ['Key'],
    ...LEGEND.map(([code, words]) => [code, words])
  ];
  const lastCol = columnLetter(head.length - 1);
  const details = [
    [title(report, 'Attendance by day')],
    [generatedLine(report)],
    [],
    ['Code', 'Name', 'Department', 'Date', 'Day', 'Shift', 'Status', 'In', 'Out', 'Hours worked', 'Late (min)', 'Left early (min)', 'LOP', 'Punched on', 'Check-in place', 'Check-out place', 'Remarks']
  ];
  for (const { employee, days } of report.rows) {
    for (const d of days) {
      if (['UPCOMING', 'NOT_JOINED'].includes(d.status)) continue;
      const r = d.record;
      const place = (p) => (p ? { v: locationLabel(p), link: p.mapUrl, tooltip: 'Open in Google Maps' } : '');
      details.push([
        employee.employeeCode, personName(employee), employee.department || '',
        d.key, WEEKDAY[d.dayStart.getDay()], d.shift?.name || '', STATUS_WORDS[d.status] || d.status,
        r?.checkIn ? formatCompanyTime(r.checkIn, { seconds: true }) : '',
        r?.checkOut ? formatCompanyTime(r.checkOut, { seconds: true }) : '',
        d.workedMinutes ? hoursLabel(d.workedMinutes) : '',
        d.lateMinutes || '', d.earlyLeaveMinutes || '', d.lopDays || '',
        r?.source ? String(r.source).replaceAll('_', ' ').toLowerCase() : '',
        place(d.places.in), place(d.places.out),
        d.holiday?.name || r?.overrideRemarks || r?.deductionReason || ''
      ]);
    }
  }
  return workbookBuffer([
    {
      name: 'Month',
      rows: muster,
      widths: [10, 24, 16, 9, ...report.days.map(() => 7), 8, 8, 8, 7, 6, 8, 10, 10, 15, 15, 9, 12],
      merges: ['A1:N1', 'A2:N2'],
      filter: `A4:${lastCol}${4 + report.rows.length}`
    },
    {
      name: 'Each day',
      rows: details,
      widths: [10, 24, 16, 11, 5, 26, 22, 13, 13, 11, 10, 14, 6, 14, 44, 44, 40],
      merges: ['A1:H1', 'A2:H2'],
      filter: `A4:Q${Math.max(4, details.length)}`
    }
  ]);
}

function earlyLeaveXlsx(report) {
  const criteria = `Left more than ${report.minMinutes} minutes before the shift ended, ${report.minTimes} or more times`;
  const people = [
    [title(report, 'Left before the shift ended')],
    [`${criteria} · ${generatedLine(report)}`],
    [],
    ['Code', 'Name', 'Department', 'Location', 'Times', 'Total minutes early', 'Average minutes early', 'Most minutes early', 'On'],
    ...report.people.map((p) => [
      p.employee.employeeCode, personName(p.employee), p.employee.department || '', workPlace(p.employee.workLocation),
      p.count,
      { v: Math.round(p.totalSeconds / 6) / 10, z: '0.0' },
      { v: Math.round(p.averageSeconds / 6) / 10, z: '0.0' },
      { v: p.most.minutesEarly, z: '0.0' },
      p.most.key
    ])
  ];
  if (!report.people.length) people.push(['Nobody left early that often in this month.']);
  const days = [
    [title(report, 'Left before the shift ended: each day')],
    [criteria],
    [],
    ['Code', 'Name', 'Date', 'Day', 'Shift', 'Shift ends', 'In', 'Left at', 'Minutes early', 'Early-leave permission']
  ];
  for (const p of report.people) {
    for (const d of p.days) {
      days.push([
        p.employee.employeeCode, personName(p.employee), d.key, d.weekday, d.shiftName,
        formatCompanyTime(d.shiftEnd), formatCompanyTime(d.checkIn, { seconds: true }), formatCompanyTime(d.checkOut, { seconds: true }),
        { v: d.minutesEarly, z: '0.0' }, d.permission ? 'Approved' : ''
      ]);
    }
  }
  return workbookBuffer([
    { name: 'People', rows: people, widths: [10, 24, 16, 9, 7, 12, 12, 12, 11], merges: ['A1:I1', 'A2:I2'], filter: `A4:I${Math.max(4, people.length)}` },
    { name: 'Each day', rows: days, widths: [10, 24, 11, 5, 26, 11, 13, 13, 9, 14], merges: ['A1:J1', 'A2:J2'], filter: `A4:J${Math.max(4, days.length)}` }
  ]);
}

/* -------------------------------------------------------------------- PDF */

const NAVY = '#1F3445';
const ORANGE = '#F38121';
const GREY = '#807F84';
const LINE = '#E1E1E4';
const SOFT = '#F2F2F3';

function pdfHeader(doc, report, heading, sub) {
  const m = doc.page.margins.left;
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(15).text(heading, m, m, { lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(sub, m, m + 20, { lineBreak: false });
  return m + 38;
}

/** Page number inside the bottom margin line (text below it would start a new page). */
function pdfFooter(doc, page) {
  const m = doc.page.margins.left;
  doc.font('Helvetica').fontSize(7.5).fillColor(GREY)
    .text(`Page ${page}`, m, doc.page.height - doc.page.margins.bottom - 9, { width: doc.page.width - 2 * m, align: 'right', lineBreak: false });
}

/** Text in a table cell, shortened with "…" when it would run into the next cell. */
function cellText(doc, text, x, y, w, { align = 'left', bold = false, color = NAVY, size = 7.2 } = {}) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
  const room = Math.max(1, w - 4);
  let value = String(text ?? '');
  if (doc.widthOfString(value) > room) {
    while (value.length > 1 && doc.widthOfString(`${value}…`) > room) value = value.slice(0, -1);
    value = `${value.trimEnd()}…`;
  }
  doc.text(value, x + 2, y, { width: room, align, lineBreak: false });
}

/** The month grid on A3 landscape pages, with the key on the last page. */
function writeMonthlyReportPdf(report, stream) {
  const doc = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 24, info: { Title: title(report, 'Attendance report') } });
  doc.pipe(stream);
  const m = 24;
  const width = doc.page.width - 2 * m;
  const totals = [['P', 'present'], ['HD', 'halfDays'], ['A', 'absent'], ['L', 'leaveDays'], ['WFH', 'wfh'], ['H', 'holidays'], ['WO', 'weekOffs'], ['Late', 'lateDays'], ['Early', 'earlyDays'], ['P?', 'reviewDays'], ['LOP', 'lopDays']];
  const codeW = 46;
  const nameW = 120;
  const totalW = 27;
  const dayW = Math.min(26, (width - codeW - nameW - totals.length * totalW) / report.days.length);
  const rowH = 13;
  const offDays = new Set(report.days.filter((d) => d.getDay() === 0 || report.holidays.some((h) => h.key === dateKey(d) && (h.location || 'ALL') === 'ALL')).map((d) => dateKey(d)));
  let page = 1;
  const sub = `${generatedLine(report)} · ${report.rows.length} ${report.rows.length === 1 ? 'person' : 'people'} · Key on the last page`;

  const columnsHead = (y) => {
    let x = m;
    doc.rect(m, y, width, rowH * 2).fill(SOFT);
    cellText(doc, 'Code', x, y + 8, codeW, { bold: true }); x += codeW;
    cellText(doc, 'Name', x, y + 8, nameW, { bold: true }); x += nameW;
    for (const d of report.days) {
      const off = offDays.has(dateKey(d));
      cellText(doc, d.getDate(), x, y + 2, dayW, { align: 'center', bold: true, color: off ? ORANGE : NAVY });
      cellText(doc, WEEKDAY[d.getDay()].slice(0, 2), x, y + 13, dayW, { align: 'center', color: GREY, size: 6.4 });
      x += dayW;
    }
    for (const [label] of totals) { cellText(doc, label, x, y + 8, totalW, { align: 'center', bold: true }); x += totalW; }
    return y + rowH * 2;
  };

  let y = pdfHeader(doc, report, title(report, 'Attendance report'), sub);
  y = columnsHead(y);
  report.rows.forEach(({ employee, days, totals: t }, index) => {
    if (y + rowH > doc.page.height - m - 12) {
      pdfFooter(doc, page);
      doc.addPage();
      page += 1;
      y = columnsHead(pdfHeader(doc, report, title(report, 'Attendance report'), sub));
    }
    if (index % 2) doc.rect(m, y, width, rowH).fill('#FAFAFB');
    let x = m;
    cellText(doc, employee.employeeCode, x, y + 3, codeW); x += codeW;
    cellText(doc, personName(employee), x, y + 3, nameW); x += nameW;
    for (const d of days) {
      if (offDays.has(d.key)) doc.rect(x, y, dayW, rowH).fill('#F4F4F5');
      const warn = ['A', 'HD', 'P?'].includes(d.code);
      cellText(doc, d.code, x, y + 3, dayW, { align: 'center', color: warn ? ORANGE : (['H', 'WO', ''].includes(d.code) ? GREY : NAVY), bold: warn, size: 6.8 });
      x += dayW;
    }
    for (const [, key] of totals) {
      const v = t[key];
      cellText(doc, v ? (Number.isInteger(v) ? v : v.toFixed(1)) : '·', x, y + 3, totalW, { align: 'center', color: key === 'lopDays' && v ? ORANGE : NAVY, bold: key === 'present' });
      x += totalW;
    }
    doc.moveTo(m, y + rowH).lineTo(m + width, y + rowH).lineWidth(0.4).strokeColor(LINE).stroke();
    y += rowH;
  });
  if (!report.rows.length) cellText(doc, 'Nobody in this report.', m, y + 6, width, { color: GREY, size: 9 });

  // Key
  const keyH = 16 + Math.ceil(LEGEND.length / 4) * 12;
  if (y + keyH + 20 > doc.page.height - m - 12) {
    pdfFooter(doc, page);
    doc.addPage();
    page += 1;
    y = pdfHeader(doc, report, title(report, 'Attendance report'), sub);
  }
  y += 14;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text('Key', m, y, { lineBreak: false });
  y += 13;
  LEGEND.forEach(([code, words], i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    cellText(doc, `${code}  ${words}`, m + col * 260, y + row * 12, 256, { size: 7.6 });
  });
  y += Math.ceil(LEGEND.length / 4) * 12 + 4;
  cellText(doc, 'Totals: P present (including worked holidays and weekly offs), HD half day, A absent, L leave days, WFH, H holidays, WO weekly offs, Late / Early = days late in or out early by the attendance rules, P? = out time missing, LOP = loss-of-pay days.', m, y, width, { color: GREY, size: 7.4 });
  pdfFooter(doc, page);
  doc.end();
}

/** Each person who left early that often, with their days, on A4 pages. */
function writeEarlyLeavePdf(report, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: title(report, 'Left before the shift ended') } });
  doc.pipe(stream);
  const m = 36;
  const width = doc.page.width - 2 * m;
  const cols = [['Date', 64], ['Day', 30], ['Shift', 118], ['Shift ends', 56], ['In', 64], ['Left at', 64], ['Early by', 58], ['Permission', 0]];
  cols[cols.length - 1][1] = width - cols.slice(0, -1).reduce((t, [, w]) => t + w, 0);
  const rowH = 15;
  let page = 1;
  const heading = title(report, 'Left before the shift ended');
  const sub = `More than ${report.minMinutes} minutes before the shift end, ${report.minTimes} or more times · ${generatedLine(report)}`;
  let y = pdfHeader(doc, report, heading, sub);
  const newPage = () => {
    pdfFooter(doc, page);
    doc.addPage();
    page += 1;
    y = pdfHeader(doc, report, heading, sub);
  };
  const tableHead = () => {
    let x = m;
    doc.rect(m, y, width, rowH).fill(SOFT);
    for (const [label, w] of cols) { cellText(doc, label, x, y + 4, w, { bold: true, size: 7.8 }); x += w; }
    y += rowH;
  };

  if (!report.people.length) {
    doc.font('Helvetica').fontSize(10).fillColor(GREY).text('Nobody left early that often in this month.', m, y + 10);
  }
  for (const p of report.people) {
    if (y + 34 + rowH * Math.min(p.days.length, 3) > doc.page.height - m - 12) newPage();
    y += 6;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY)
      .text(`${personName(p.employee)} · ${p.employee.employeeCode}`, m, y, { lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY)
      .text(`${[p.employee.department, workPlace(p.employee.workLocation)].filter(Boolean).join(' · ')}  ·  ${p.count} times  ·  ${Math.round(p.totalSeconds / 60)} min in all`, m, y + 14, { lineBreak: false });
    y += 28;
    tableHead();
    p.days.forEach((d) => {
      if (y + rowH > doc.page.height - m - 12) { newPage(); tableHead(); }
      let x = m;
      const values = [d.key, d.weekday, d.shiftName, formatCompanyTime(d.shiftEnd), formatCompanyTime(d.checkIn, { seconds: true }), formatCompanyTime(d.checkOut, { seconds: true }), earlyLabel(d.secondsEarly), d.permission ? 'Approved' : ''];
      values.forEach((v, i) => { cellText(doc, v, x, y + 4, cols[i][1], { size: 7.8, color: i === 6 ? ORANGE : NAVY, bold: i === 6 }); x += cols[i][1]; });
      doc.moveTo(m, y + rowH).lineTo(m + width, y + rowH).lineWidth(0.4).strokeColor(LINE).stroke();
      y += rowH;
    });
    y += 8;
  }
  pdfFooter(doc, page);
  doc.end();
}

/* ----------------------------------------------------------------- JSON */

/** What the Reports tab shows on screen. */
function earlyLeaveJson(report) {
  return {
    month: report.month,
    place: report.place,
    minMinutes: report.minMinutes,
    minTimes: report.minTimes,
    people: report.people.map((p) => ({
      employeeId: String(p.employee._id),
      employeeCode: p.employee.employeeCode,
      name: personName(p.employee),
      department: p.employee.department || '',
      workLocation: workPlace(p.employee.workLocation),
      count: p.count,
      totalMinutes: Math.round(p.totalSeconds / 6) / 10,
      averageMinutes: Math.round(p.averageSeconds / 6) / 10,
      days: p.days.map((d) => ({
        date: d.key,
        weekday: d.weekday,
        shiftName: d.shiftName,
        shiftEnd: d.shiftEnd,
        checkIn: d.checkIn,
        checkOut: d.checkOut,
        minutesEarly: d.minutesEarly,
        permission: d.permission
      }))
    }))
  };
}

function monthlyJson(report) {
  return {
    month: report.month,
    place: report.place,
    days: report.days.map((d) => dateKey(d)),
    people: report.rows.map(({ employee, days, totals }) => ({
      employeeId: String(employee._id),
      employeeCode: employee.employeeCode,
      name: personName(employee),
      department: employee.department || '',
      codes: days.map((d) => d.code),
      totals: { ...totals, hoursWorked: hoursLabel(totals.workedMinutes) }
    }))
  };
}

module.exports = {
  CODES,
  LEGEND,
  monthlyReport,
  earlyLeaveReport,
  monthlyReportXlsx,
  earlyLeaveXlsx,
  writeMonthlyReportPdf,
  writeEarlyLeavePdf,
  earlyLeaveJson,
  monthlyJson,
  placeOf,
  monthTitle
};

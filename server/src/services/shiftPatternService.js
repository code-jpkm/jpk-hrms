/**
 * Weekly shift patterns: "Mon–Fri 10:30 am – 6:30 pm, Saturday 10:30 am – 3:30 pm"
 * (days not named are the weekly off).
 *
 * plan()    works out what will change, without saving anything: which shift
 *           each part uses (an existing one with the same times, or a new one),
 *           the weekly off, and which later shift rows the pattern replaces.
 * apply()   saves it: creates any missing shift, removes the person's shift rows
 *           that start on or after the first day (they are replaced), adds one row
 *           per part limited to its weekdays, and recalculates the days that have
 *           already happened (punches, LOP, payroll draft).
 *
 * The part with the most days also carries the weekly off: its shift has those
 * days as weekly off, so the calendar shows "Weekly off" there as usual.
 */
const Shift = require('../models/Shift');
const ShiftAssignment = require('../models/ShiftAssignment');
const RuleAudit = require('../models/RuleAudit');
const ApiError = require('../utils/apiError');
const { dateKey, companyToday } = require('../utils/date');
const { normalizeWeekdays, weekdaysLabel, upsertShiftAssignment, recalculateAfterShiftChange, DAY_LONG } = require('./shiftAssignmentService');

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function toMinutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** "9:5" / "09:05" / "9.30" / "930" / "6:30 pm" / "18:30" → "HH:MM" (24 h); null when unreadable. */
function normalizeTime(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  let m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) {
    m = s.match(/^(\d{3,4})\s*(am|pm)?$/);
    if (m) m = [m[0], m[1].slice(0, -2), m[1].slice(-2), m[2]];
  }
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3] ? m[3].replace(/\./g, '') : '';
  if (min > 59 || h > 24) return null;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h === 24) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "10:30" → "10:30 am", "18:30" → "6:30 pm". */
function timeLabel(hhmm) {
  const t = toMinutes(hhmm);
  if (!Number.isFinite(t)) return String(hhmm || '');
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

function durationOf(start, end) {
  let d = toMinutes(end) - toMinutes(start);
  if (d <= 0) d += 24 * 60;
  return d;
}

function sameDaySet(a = [], b = []) {
  const x = [...new Set(a.map(Number))].sort().join(',');
  const y = [...new Set(b.map(Number))].sort().join(',');
  return x === y;
}

/** Cleans the parts: valid times, no day in two parts, parts with the same times merged. */
function normalizeSegments(rawSegments = [], rawOffDays = []) {
  const segments = [];
  for (const raw of Array.isArray(rawSegments) ? rawSegments : []) {
    const startTime = normalizeTime(raw?.startTime);
    const endTime = normalizeTime(raw?.endTime);
    const days = normalizeWeekdays(raw?.weekdays) || (Array.isArray(raw?.weekdays) && raw.weekdays.length === 7 ? ALL_DAYS : null);
    const shiftId = raw?.shiftId ? String(raw.shiftId) : '';
    if (!days) throw new ApiError(400, 'Say which days each timing is for, for example Monday to Friday 10:30 am to 6:30 pm');
    if (!shiftId && (!startTime || !endTime)) throw new ApiError(400, `Give a start and end time for ${weekdaysLabel(days, { long: true })}`);
    if (!shiftId && startTime === endTime) throw new ApiError(400, 'The start and end time cannot be the same');
    const twin = segments.find((s) => (shiftId ? s.shiftId === shiftId : (!s.shiftId && s.startTime === startTime && s.endTime === endTime)));
    if (twin) twin.weekdays = normalizeWeekdays([...twin.weekdays, ...days]) || ALL_DAYS;
    else segments.push({ weekdays: days, startTime, endTime, shiftId });
  }
  if (!segments.length) throw new ApiError(400, 'Say the timing, for example Monday to Friday 10:30 am to 6:30 pm');
  const seen = new Map();
  for (const seg of segments) {
    for (const d of seg.weekdays) {
      if (seen.has(d)) throw new ApiError(400, `${DAY_LONG[d]} has two timings. Give each day one timing.`);
      seen.set(d, seg);
    }
  }
  const named = [...seen.keys()];
  const offDays = ALL_DAYS.filter((d) => !named.includes(d) || (Array.isArray(rawOffDays) && rawOffDays.map(Number).includes(d)));
  for (const d of offDays) for (const seg of segments) seg.weekdays = seg.weekdays.filter((x) => x !== d);
  const kept = segments.filter((s) => s.weekdays.length);
  if (!kept.length) throw new ApiError(400, 'Every day is a weekly off. Give at least one working day and its timing.');
  // The part with the most days carries the weekly off.
  let main = kept[0];
  for (const s of kept) if (s.weekdays.length > main.weekdays.length) main = s;
  return { segments: kept, offDays, main };
}

/** An existing shift with these times that works on `workDays` and is off on `offDays`; the closest weekly-off match first. */
async function findShift(tenantId, { startTime, endTime, workDays, offDays }) {
  const candidates = await Shift.find({ tenantId, active: { $ne: false }, startTime, endTime }).sort('createdAt').lean();
  const usable = candidates.filter((s) => {
    const off = (Array.isArray(s.weeklyOffDays) ? s.weeklyOffDays : [0]).map(Number);
    return workDays.every((d) => !off.includes(d)) && offDays.every((d) => off.includes(d));
  });
  usable.sort((a, b) => Number(sameDaySet(b.weeklyOffDays || [0], offDays)) - Number(sameDaySet(a.weeklyOffDays || [0], offDays)));
  return usable[0] || null;
}

async function uniqueShiftName(tenantId, base) {
  let name = base;
  for (let i = 2; await Shift.exists({ tenantId, name }); i += 1) name = `${base} (${i})`;
  return name;
}

function newShiftDraft({ startTime, endTime, offDays }) {
  const duration = durationOf(startTime, endTime);
  const offLabel = offDays.length ? ` · ${weekdaysLabel(offDays)} off` : '';
  return {
    name: `${startTime}–${endTime}${offLabel}`,
    startTime,
    endTime,
    crossesMidnight: toMinutes(endTime) <= toMinutes(startTime),
    durationMinutes: duration,
    graceMinutes: 15,
    fullDayMinutes: duration,
    halfDayMinutes: Math.max(1, Math.round(duration / 2)),
    weeklyOffDays: offDays,
    active: true
  };
}

/** Resolves each part to a shift (existing, or a new one to create). */
async function resolveShifts(tenantId, { segments, offDays, main }) {
  const out = [];
  for (const seg of segments) {
    const isMain = seg === main;
    const workDays = seg.weekdays;
    const segOff = isMain ? offDays : [];
    let shift = null;
    if (seg.shiftId) {
      shift = await Shift.findOne({ _id: seg.shiftId, tenantId }).lean();
      if (!shift) throw new ApiError(404, 'That shift was not found');
      const off = (shift.weeklyOffDays || [0]).map(Number);
      const clash = workDays.find((d) => off.includes(d));
      if (clash !== undefined) throw new ApiError(400, `${shift.name} has ${DAY_LONG[clash]} as its weekly off, so it cannot be used on ${DAY_LONG[clash]}s`);
    } else {
      shift = await findShift(tenantId, { startTime: seg.startTime, endTime: seg.endTime, workDays, offDays: segOff });
    }
    out.push({
      weekdays: isMain ? normalizeWeekdays([...workDays, ...offDays]) || ALL_DAYS : workDays,
      workDays,
      offDays: segOff,
      isMain,
      shift: shift ? { _id: String(shift._id), name: shift.name, startTime: shift.startTime, endTime: shift.endTime, isNew: false } : { ...newShiftDraft({ startTime: seg.startTime, endTime: seg.endTime, offDays: segOff }), isNew: true }
    });
  }
  return out;
}

function partLabel(part) {
  return `${weekdaysLabel(part.workDays)} ${timeLabel(part.shift.startTime)} – ${timeLabel(part.shift.endTime)}`;
}

/** Plain-words summary: "Mon–Fri 10:30 am – 6:30 pm · Sat 10:30 am – 3:30 pm · Sun off". */
function patternLabel(parts, offDays) {
  // Monday-first, so "Mon–Fri …" comes before "Sat …" and Sunday last.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const first = (p) => Math.min(...p.workDays.map((d) => order.indexOf(d)));
  const sorted = [...parts].sort((a, b) => first(a) - first(b));
  const bits = sorted.map(partLabel);
  if (offDays.length) bits.push(`${weekdaysLabel(offDays)} off`);
  return bits.join(' · ');
}

function checkRange(fromDate, toDate) {
  const from = String(fromDate || '').slice(0, 10) || dateKey(companyToday());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new ApiError(400, 'The first day must be a date');
  const to = toDate ? String(toDate).slice(0, 10) : null;
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ApiError(400, 'The last day must be a date');
  if (to && to < from) throw new ApiError(400, 'The last day cannot be before the first day');
  return { from, to };
}

/** Rows a change from `from` (to `to`) replaces, and rows that start inside it but run past its end. */
function rowsReplaced(rows, from, to) {
  const replaced = [];
  const moved = [];
  for (const row of rows) {
    const start = row.fromDate ? dateKey(row.fromDate) : '';
    const end = row.toDate ? dateKey(row.toDate) : null;
    if (!start || start < from) continue;
    if (!to) { replaced.push(row); continue; }
    if (start > to) continue;
    if (end && end <= to) replaced.push(row);
    else moved.push(row);
  }
  return { replaced, moved };
}

/**
 * What a pattern would do, without saving. `employees` are Employee documents
 * already checked against the caller's scope.
 */
async function plan({ tenantId, employees, segments: rawSegments, offDays: rawOff, fromDate, toDate }) {
  if (!employees?.length) throw new ApiError(400, 'Say whose shift to change');
  const { from, to } = checkRange(fromDate, toDate);
  const normalized = normalizeSegments(rawSegments, rawOff);
  const parts = await resolveShifts(tenantId, normalized);
  const rows = await ShiftAssignment.find({ tenantId, employeeId: { $in: employees.map((e) => e._id) } }).lean();
  const byEmployee = new Map();
  for (const row of rows) {
    const key = String(row.employeeId);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push(row);
  }
  const people = employees.map((e) => {
    const { replaced, moved } = rowsReplaced(byEmployee.get(String(e._id)) || [], from, to);
    return { _id: String(e._id), employeeCode: e.employeeCode, name: `${e.firstName || ''} ${e.lastName || ''}`.trim(), replaced: replaced.length, moved: moved.length };
  });
  const today = dateKey(companyToday());
  return {
    fromDate: from,
    toDate: to,
    parts,
    offDays: normalized.offDays,
    label: patternLabel(parts, normalized.offDays),
    newShifts: parts.filter((p) => p.shift.isNew).map((p) => p.shift.name),
    people,
    recalculates: from <= today
  };
}

/** Saves a pattern (see plan). Returns the plan plus what was recalculated. */
async function apply(req, { employees, segments, offDays, fromDate, toDate, reason }) {
  const tenantId = req.tenantId;
  const planned = await plan({ tenantId, employees, segments, offDays, fromDate, toDate });
  const { fromDate: from, toDate: to } = planned;
  // Missing shifts first, so every part has an id.
  for (const part of planned.parts) {
    if (!part.shift.isNew) continue;
    const draft = { ...part.shift };
    delete draft.isNew;
    draft.name = await uniqueShiftName(tenantId, draft.name);
    const created = await Shift.create({ ...draft, tenantId });
    part.shift = { _id: String(created._id), name: created.name, startTime: created.startTime, endTime: created.endTime, isNew: true };
  }

  const before = await ShiftAssignment.find({ tenantId, employeeId: { $in: employees.map((e) => e._id) } }).lean();
  const byEmployee = new Map();
  for (const row of before) {
    const key = String(row.employeeId);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push(row);
  }
  const removed = [];
  const moved = [];
  const added = [];
  const dayAfter = to ? new Date(Date.parse(`${to}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10) : null;
  for (const employee of employees) {
    const rows = byEmployee.get(String(employee._id)) || [];
    const { replaced, moved: straddling } = rowsReplaced(rows, from, to);
    if (replaced.length) {
      await ShiftAssignment.deleteMany({ _id: { $in: replaced.map((r) => r._id) } });
      removed.push(...replaced);
    }
    for (const row of straddling) {
      await ShiftAssignment.updateOne({ _id: row._id }, { $set: { fromDate: new Date(`${dayAfter}T00:00:00.000Z`) } });
      moved.push({ ...row, newFromDate: dayAfter });
    }
    for (const part of planned.parts) {
      const row = await upsertShiftAssignment({
        tenantId,
        employeeId: employee._id,
        shiftId: part.shift._id,
        fromDate: new Date(`${from}T00:00:00.000Z`),
        toDate: to ? new Date(`${to}T00:00:00.000Z`) : null,
        weekdays: part.weekdays,
        assignedBy: req.user._id
      });
      added.push(row.toObject());
    }
  }

  const why = reason || `Shift pattern ${planned.label} from ${from}${to ? ` to ${to}` : ' onwards'}`;
  await RuleAudit.create({
    tenantId,
    module: 'SHIFT',
    action: 'SHIFT_PATTERN_CHANGED',
    targetId: employees.map((e) => String(e._id)).join(','),
    before: { rowsRemoved: removed, rowsMoved: moved },
    after: { pattern: planned.label, fromDate: from, toDate: to, rowsAdded: added },
    reason: why,
    source: req.aiSource || undefined,
    changedBy: req.user._id
  });

  const recalculated = await recalculateAfterShiftChange(req, { employeeIds: employees.map((e) => e._id), fromDate: from, toDate: to, reason: why });
  return { ...planned, removed: removed.length, moved: moved.length, added: added.length, recalculated };
}

module.exports = { plan, apply, normalizeTime, timeLabel, normalizeSegments, patternLabel };

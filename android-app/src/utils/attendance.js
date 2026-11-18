// Same labels and colours as the website (ui/views/attendance/meta.js).
export const STATUS = {
  PRESENT: { label: 'Present', short: 'P', dot: '#1F3445', bg: '#EFF3F6', fg: '#1F3445' },
  ABSENT: { label: 'Absent', short: 'A', dot: '#F38121', bg: '#FDE7D4', fg: '#A45210' },
  HALF_DAY: { label: 'Half day', short: 'HD', dot: '#F8B57D', bg: '#FEF4EA', fg: '#B85C10', border: '#FBD3B0' },
  LEAVE: { label: 'On leave', short: 'L', dot: '#5D7284', bg: '#FFFFFF', fg: '#3E5568', border: '#C3CDD6' },
  WFH: { label: 'Work from home', short: 'WFH', dot: '#3E5568', bg: '#EFF3F6', fg: '#3E5568' },
  HOLIDAY: { label: 'Holiday', short: 'H', dot: '#807F84', bg: '#E1E1E4', fg: '#3D3D41' },
  WEEK_OFF: { label: 'Weekly off', short: 'WO', dot: '#C5C4C8', bg: '#FFFFFF', fg: '#807F84', border: '#E1E1E4' },
  IN_PROGRESS: { label: 'On duty now', short: 'IN', dot: '#1F3445', bg: '#EFF3F6', fg: '#1F3445' },
  NOT_MARKED: { label: 'Not marked yet', short: '–', dot: '#A2A1A6', bg: '#F7F7F8', fg: '#6A6A6F' },
  UPCOMING: { label: 'Upcoming', short: '', dot: '#E1E1E4', bg: '#FFFFFF', fg: '#A2A1A6' },
  NOT_JOINED: { label: 'Before joining', short: '', dot: '#E1E1E4', bg: '#FFFFFF', fg: '#A2A1A6' }
};

export function statusMeta(status) {
  return STATUS[status] || { label: String(status || '').replace(/_/g, ' ').toLowerCase(), short: '?', dot: '#A2A1A6', bg: '#F7F7F8', fg: '#6A6A6F' };
}

export const TEAM_STATES = {
  IN: { label: 'On duty', dot: '#1F3445' },
  DONE: { label: 'Completed', dot: '#5D7284' },
  NOT_YET: { label: 'Shift not started', dot: '#C5C4C8' },
  MISSING: { label: 'Not checked in', dot: '#F38121' },
  ABSENT: { label: 'Absent', dot: '#F38121' },
  LEAVE: { label: 'On leave', dot: '#8C9DAB' },
  WFH: { label: 'WFH', dot: '#3E5568' },
  HOLIDAY: { label: 'Holiday', dot: '#807F84' },
  WEEK_OFF: { label: 'Weekly off', dot: '#C5C4C8' },
  UPCOMING: { label: 'Upcoming', dot: '#E1E1E4' }
};

export const LEAVE_NAMES = { EL: 'Earned leave', CL: 'Casual leave', SL: 'Sick leave', COMP_OFF: 'Comp off', LOP: 'Unpaid leave', WFH: 'Work from home' };

export function leaveName(code) {
  return LEAVE_NAMES[code] || String(code || '').replace(/_/g, ' ');
}

export const CORRECTION_TYPES = [
  { value: 'ATTENDANCE_CORRECTION', label: 'Fix check-in / check-out', needsTimes: true },
  { value: 'LATE_IN', label: 'Late coming (permission)' },
  { value: 'EARLY_LEAVE', label: 'Leaving early (permission)' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'SPECIAL', label: 'Special permission' }
];

export function correctionLabel(type) {
  return CORRECTION_TYPES.find((t) => t.value === type)?.label || String(type || '').replace(/_/g, ' ').toLowerCase();
}

export function isIssue(day) {
  if (!day || ['HOLIDAY', 'WEEK_OFF', 'UPCOMING', 'NOT_JOINED', 'IN_PROGRESS'].includes(day.status)) return false;
  return ['ABSENT', 'HALF_DAY'].includes(day.status) || day.missingPunch || day.lateMinutes > 0 || day.earlyLeaveMinutes > 0 || Number(day.lopDays) > 0;
}

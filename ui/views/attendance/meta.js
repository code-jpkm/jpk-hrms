// Shared labels and colours for the attendance screens.

// Calm palette built only from the JPK brand colours: navy = attended,
// orange = needs attention (absent / half day / late), grey = no duty.
export const STATUS = {
  PRESENT: { label: 'Present', short: 'P', tone: 'present', dot: '#1F3445', soft: '#EFF3F6' },
  ABSENT: { label: 'Absent', short: 'A', tone: 'absent', dot: '#F38121', soft: '#FDE7D4' },
  HALF_DAY: { label: 'Half day', short: 'HD', tone: 'half', dot: '#F8B57D', soft: '#FEF4EA' },
  LEAVE: { label: 'On leave', short: 'L', tone: 'leave', dot: '#5D7284', soft: '#EFF3F6' },
  WFH: { label: 'Work from home', short: 'WFH', tone: 'wfh', dot: '#3E5568', soft: '#EFF3F6' },
  HOLIDAY: { label: 'Holiday', short: 'H', tone: 'holiday', dot: '#807F84', soft: '#F2F2F3' },
  WEEK_OFF: { label: 'Weekly off', short: 'WO', tone: 'off', dot: '#C5C4C8', soft: '#F7F7F8' },
  IN_PROGRESS: { label: 'On duty now', short: 'IN', tone: 'live', dot: '#1F3445', soft: '#EFF3F6' },
  NOT_MARKED: { label: 'Not marked yet', short: '–', tone: 'pending', dot: '#A2A1A6', soft: '#F7F7F8' },
  UPCOMING: { label: 'Upcoming', short: '', tone: 'future', dot: '#E1E1E4', soft: '#FFFFFF' },
  NOT_JOINED: { label: 'Before joining', short: '', tone: 'future', dot: '#E1E1E4', soft: '#FFFFFF' }
};

export function statusMeta(status) {
  return STATUS[status] || { label: String(status || '').replaceAll('_', ' ').toLowerCase(), short: '?', tone: 'pending', dot: '#A2A1A6', soft: '#F7F7F8' };
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

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isIssue(day) {
  if (!day || ['HOLIDAY', 'WEEK_OFF', 'UPCOMING', 'NOT_JOINED', 'IN_PROGRESS'].includes(day.status)) return false;
  return ['ABSENT', 'HALF_DAY'].includes(day.status) || day.missingPunch || day.lateMinutes > 0 || day.earlyLeaveMinutes > 0 || Number(day.lopDays) > 0;
}

/** Download rows as a CSV file. */
export function downloadCsv(filename, header, rows) {
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Catalogue of every HR event that can send an email and/or WhatsApp message.
 *
 * Each entry declares:
 *  - defaults: which channels are on until an admin changes them in
 *    Company Settings → Integrations → Notification rules;
 *  - template: the suggested Meta WhatsApp template (name, body, and the
 *    order in which the dispatcher fills {{1}}, {{2}}, …). Meta only allows
 *    business-initiated messages through approved templates, so the admin
 *    creates these once in WhatsApp Manager (category: Utility);
 *  - build(data): the email + WhatsApp text for one recipient.
 *
 * `data` always contains recipientName, company and link (absolute URL into
 * the HRMS), plus the event-specific fields documented next to each builder.
 */
const { semanticDateKey } = require('../../utils/date');

function fmtDay(value) {
  if (!value) return '';
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : semanticDateKey(value);
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short' });
  const month = date.toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short' });
  return `${weekday}, ${d} ${month} ${y}`;
}

function fmtTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
}

function range(from, to) {
  const a = fmtDay(from);
  const b = fmtDay(to || from);
  return a === b ? a : `${a} to ${b}`;
}

function plural(n, word) {
  const v = Number(n);
  return `${Number.isFinite(v) ? v : n} ${word}${v === 1 ? '' : 's'}`;
}

const LEAVE_LABELS = { EL: 'Earned Leave', CL: 'Casual Leave', SL: 'Sick Leave', COMP_OFF: 'Compensatory Off', LOP: 'Leave without pay', WFH: 'Work from home' };
function leaveLabel(type, requestType) {
  if (requestType === 'WFH') return 'Work from home';
  return LEAVE_LABELS[String(type || '').toUpperCase()] || String(type || 'Leave');
}

const DECISION_WORD = { APPROVED: 'approved', REJECTED: 'rejected', CANCELLED: 'cancelled' };

const EVENTS = {
  LEAVE_SUBMITTED: {
    group: 'Leave & attendance',
    label: 'Leave or WFH request submitted',
    audience: 'Reporting manager (HR when no manager is mapped)',
    defaults: { email: true, whatsapp: true, inApp: true },
    template: {
      name: 'hrms_leave_request',
      body: 'Hello {{1}}, {{2}} has applied for {{3}} from {{4}} to {{5}} ({{6}} days). Reason: {{7}}. Please review the request in the {{company}} HRMS.',
      params: ['recipientName', 'employeeName', 'leaveLabel', 'fromLabel', 'toLabel', 'days', 'reason']
    },
    // employeeName, employeeCode, leaveType, requestType, fromDate, toDate, days, reason
    build(d) {
      const label = leaveLabel(d.leaveType, d.requestType);
      const when = range(d.fromDate, d.toDate);
      return {
        vars: { leaveLabel: label, fromLabel: fmtDay(d.fromDate), toLabel: fmtDay(d.toDate || d.fromDate) },
        subject: `${d.employeeName} requested ${label} · ${plural(d.days, 'day')}`,
        heading: `${label} request from ${d.employeeName}`,
        intro: `${d.employeeName} has asked for ${plural(d.days, 'day')} of ${label.toLowerCase()}. Please approve or reject it before the dates begin.`,
        rows: [['Employee', `${d.employeeName}${d.employeeCode ? ` (${d.employeeCode})` : ''}`], ['Request', label], ['Dates', when], ['Days', d.days], ['Reason', d.reason || 'Not given']],
        cta: { label: 'Review request', path: '/leave' },
        whatsapp: `*${label} request*\n${d.employeeName} has applied for ${plural(d.days, 'day')}.\nDates: ${when}\nReason: ${d.reason || 'Not given'}\n\nReview: ${d.link}`
      };
    }
  },

  LEAVE_DECIDED: {
    group: 'Leave & attendance',
    label: 'Leave or WFH request approved / rejected',
    audience: 'The employee who applied',
    defaults: { email: true, whatsapp: true, inApp: true },
    template: {
      name: 'hrms_leave_status',
      body: 'Hello {{1}}, your {{2}} request for {{3}} has been {{4}} by {{5}}. Remarks: {{6}}. Thank you, {{company}} HR.',
      params: ['recipientName', 'leaveLabel', 'when', 'decisionWord', 'decidedBy', 'remarks']
    },
    // leaveType, requestType, fromDate, toDate, days, status, decidedBy, remarks
    build(d) {
      const label = leaveLabel(d.leaveType, d.requestType);
      const when = range(d.fromDate, d.toDate);
      const word = DECISION_WORD[d.status] || String(d.status || '').toLowerCase();
      return {
        vars: { leaveLabel: label, when, decisionWord: word, remarks: d.remarks || 'None' },
        subject: `Your ${label.toLowerCase()} request was ${word}`,
        heading: `${label} ${word}`,
        intro: d.status === 'APPROVED'
          ? `Your request for ${when} has been approved${d.decidedBy ? ` by ${d.decidedBy}` : ''}. Your attendance calendar has been updated.`
          : `Your request for ${when} was ${word}${d.decidedBy ? ` by ${d.decidedBy}` : ''}.`,
        rows: [['Request', label], ['Dates', when], ['Days', d.days], ['Status', word.charAt(0).toUpperCase() + word.slice(1)], ['Remarks', d.remarks || 'None']],
        cta: { label: 'Open my leave', path: '/leave' },
        tone: d.status === 'APPROVED' ? 'positive' : 'negative',
        whatsapp: `${d.status === 'APPROVED' ? '✅' : '❌'} *${label} ${word}*\nDates: ${when} (${plural(d.days, 'day')})\n${d.decidedBy ? `By: ${d.decidedBy}\n` : ''}Remarks: ${d.remarks || 'None'}\n\n${d.link}`
      };
    }
  },

  REGULARIZATION_SUBMITTED: {
    group: 'Leave & attendance',
    label: 'Attendance regularization submitted',
    audience: 'Reporting manager (HR when no manager is mapped)',
    defaults: { email: true, whatsapp: false, inApp: true },
    template: {
      name: 'hrms_regularization_request',
      body: 'Hello {{1}}, {{2}} has requested an attendance correction ({{3}}) for {{4}}. Reason: {{5}}. Please review it in the {{company}} HRMS.',
      params: ['recipientName', 'employeeName', 'typeLabel', 'dateLabel', 'reason']
    },
    // employeeName, employeeCode, date, requestType, checkIn, checkOut, reason
    build(d) {
      const typeLabel = String(d.requestType || 'ATTENDANCE_CORRECTION').replace(/_/g, ' ').toLowerCase();
      const times = [d.checkIn && `in ${fmtTime(d.checkIn)}`, d.checkOut && `out ${fmtTime(d.checkOut)}`].filter(Boolean).join(', ');
      return {
        vars: { typeLabel, dateLabel: fmtDay(d.date) },
        subject: `Attendance correction from ${d.employeeName} · ${fmtDay(d.date)}`,
        heading: 'Attendance correction requested',
        intro: `${d.employeeName} has asked to correct attendance for ${fmtDay(d.date)}.`,
        rows: [['Employee', `${d.employeeName}${d.employeeCode ? ` (${d.employeeCode})` : ''}`], ['Date', fmtDay(d.date)], ['Type', typeLabel], ['Requested times', times || 'Not applicable'], ['Reason', d.reason || 'Not given']],
        cta: { label: 'Review request', path: '/regularization' },
        whatsapp: `*Attendance correction request*\n${d.employeeName} · ${fmtDay(d.date)}\nType: ${typeLabel}${times ? `\nTimes: ${times}` : ''}\nReason: ${d.reason || 'Not given'}\n\nReview: ${d.link}`
      };
    }
  },

  REGULARIZATION_DECIDED: {
    group: 'Leave & attendance',
    label: 'Attendance regularization approved / rejected',
    audience: 'The employee who applied',
    defaults: { email: true, whatsapp: false, inApp: true },
    template: {
      name: 'hrms_regularization_status',
      body: 'Hello {{1}}, your attendance request for {{2}} has been {{3}}. Remarks: {{4}}. Thank you, {{company}} HR.',
      params: ['recipientName', 'dateLabel', 'decisionWord', 'remarks']
    },
    build(d) {
      const word = DECISION_WORD[d.status] || String(d.status || '').toLowerCase();
      return {
        vars: { dateLabel: fmtDay(d.date), decisionWord: word, remarks: d.remarks || 'None' },
        subject: `Attendance request for ${fmtDay(d.date)} was ${word}`,
        heading: `Attendance request ${word}`,
        intro: `Your attendance request for ${fmtDay(d.date)} was ${word}${d.decidedBy ? ` by ${d.decidedBy}` : ''}.`,
        rows: [['Date', fmtDay(d.date)], ['Status', word], ['Remarks', d.remarks || 'None']],
        cta: { label: 'Open my attendance', path: '/attendance' },
        tone: d.status === 'APPROVED' ? 'positive' : 'negative',
        whatsapp: `${d.status === 'APPROVED' ? '✅' : '❌'} *Attendance request ${word}*\nDate: ${fmtDay(d.date)}\nRemarks: ${d.remarks || 'None'}\n\n${d.link}`
      };
    }
  },

  PERMISSION_SUBMITTED: {
    group: 'Leave & attendance',
    label: 'Short permission requested',
    audience: 'Approver',
    defaults: { email: true, whatsapp: false, inApp: true },
    template: {
      name: 'hrms_permission_request',
      body: 'Hello {{1}}, {{2}} has requested {{3}} permission on {{4}}. Reason: {{5}}. Please review it in the {{company}} HRMS.',
      params: ['recipientName', 'employeeName', 'typeLabel', 'dateLabel', 'reason']
    },
    build(d) {
      const typeLabel = String(d.type || 'short').replace(/_/g, ' ').toLowerCase();
      return {
        vars: { typeLabel, dateLabel: fmtDay(d.date) },
        subject: `Permission request from ${d.employeeName}`,
        heading: 'Permission requested',
        intro: `${d.employeeName} has requested ${typeLabel} permission${d.minutes ? ` for ${d.minutes} minutes` : ''}.`,
        rows: [['Employee', d.employeeName], ['Date', fmtDay(d.date)], ['Type', typeLabel], ['Reason', d.reason || 'Not given']],
        cta: { label: 'Review request', path: '/regularization' },
        whatsapp: `*Permission request*\n${d.employeeName} · ${fmtDay(d.date)}\nType: ${typeLabel}\nReason: ${d.reason || 'Not given'}\n\n${d.link}`
      };
    }
  },

  PAYSLIP_PUBLISHED: {
    group: 'Payroll',
    label: 'Payslip published',
    audience: 'Each employee in the payroll run',
    defaults: { email: true, whatsapp: true, inApp: true },
    template: {
      name: 'hrms_payslip_ready',
      body: 'Hello {{1}}, your payslip for {{2}} has been published. You can view and download it here: {{3}} . Thank you, {{company}} HR.',
      params: ['recipientName', 'monthLabel', 'link']
    },
    // month (YYYY-MM), netPay (optional, shown only in email), slipLink
    build(d) {
      const [y, m] = String(d.month || '').split('-').map(Number);
      const monthLabel = y && m ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' }) : d.month;
      return {
        vars: { monthLabel },
        subject: `Your payslip for ${monthLabel}`,
        heading: `Payslip for ${monthLabel}`,
        intro: `Your salary slip for ${monthLabel} is ready.${d.attached ? ' The PDF is attached to this email.' : ''}`,
        rows: [['Month', monthLabel], ...(d.netPay !== undefined ? [['Net pay', d.netPay]] : []), ['Employee code', d.employeeCode || '']].filter((r) => r[1] !== ''),
        cta: { label: 'Download payslip', url: d.slipLink || d.link },
        whatsapp: `💼 *Payslip for ${monthLabel}*\nYour salary slip is ready.\nDownload: ${d.slipLink || d.link}`
      };
    }
  },

  PAYROLL_GENERATED: {
    group: 'Payroll',
    label: 'Payroll generated (for HR)',
    audience: 'Super Admin and HR Admin',
    defaults: { email: true, whatsapp: false, inApp: true },
    template: {
      name: 'hrms_payroll_generated',
      body: 'Hello {{1}}, payroll for {{2}} has been generated for {{3}} employees. Please review and release it in the {{company}} HRMS.',
      params: ['recipientName', 'monthLabel', 'count']
    },
    build(d) {
      const [y, m] = String(d.month || '').split('-').map(Number);
      const monthLabel = y && m ? new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' }) : d.month;
      return {
        vars: { monthLabel },
        subject: `Payroll for ${monthLabel} is ready for review`,
        heading: `Payroll generated · ${monthLabel}`,
        intro: `${plural(d.count, 'salary slip')} were generated${d.by ? ` by ${d.by}` : ''}. Review exceptions before releasing.`,
        rows: [['Month', monthLabel], ['Employees', d.count], ...(d.totalNet ? [['Total net pay', d.totalNet]] : [])],
        cta: { label: 'Review payroll', path: '/payroll' },
        whatsapp: `*Payroll generated · ${monthLabel}*\n${plural(d.count, 'slip')} ready for review.\n${d.link}`
      };
    }
  },

  ACCESS_INVITE: {
    group: 'People',
    label: 'HRMS login details (new or reset)',
    audience: 'Employee who was given login details',
    // Holds a temporary password: the text is removed from the log once sent
    // and never shown in the message history.
    sensitive: true,
    defaults: { email: true, whatsapp: true, inApp: false },
    template: {
      name: 'hrms_login_details',
      body: 'Hello {{1}}, your {{company}} HRMS login is ready. Sign in at {{2}} with {{3}} and the temporary password {{4}} . You will choose your own password after signing in.',
      params: ['recipientName', 'loginUrl', 'loginEmail', 'temporaryPassword']
    },
    build(d) {
      return {
        subject: `Your ${d.company} HRMS login details`,
        heading: `Welcome to ${d.company}, ${d.recipientName}`,
        intro: 'Your HRMS login is ready. Use it to mark attendance, apply for leave, download payslips and read company notices. Sign in with the temporary password below; you will be asked to choose your own password straight away.',
        rows: [
          ['Sign-in page', d.loginUrl],
          ['Email (login name)', d.loginEmail],
          ...(d.employeeCode ? [['Or employee code', d.employeeCode]] : []),
          ['Temporary password', d.temporaryPassword]
        ],
        cta: { label: 'Sign in to HRMS', url: d.loginUrl },
        whatsapp: `👋 *Your ${d.company} HRMS login*\nSign in: ${d.loginUrl}\nLogin: ${d.loginEmail}\nTemporary password: *${d.temporaryPassword}*\nYou will choose your own password after signing in. Do not share this message.`
      };
    }
  },

  PASSWORD_RESET: {
    group: 'People',
    label: 'Password reset link',
    audience: 'Person who asked to reset their password',
    sensitive: true,
    defaults: { email: true, whatsapp: true, inApp: false },
    template: {
      name: 'hrms_password_reset',
      body: 'Hello {{1}}, use this link to choose a new {{company}} HRMS password: {{2}} . It works for {{3}} minutes. If you did not ask for this, ignore this message.',
      params: ['recipientName', 'resetUrl', 'minutes']
    },
    build(d) {
      return {
        subject: `Reset your ${d.company} HRMS password`,
        heading: 'Choose a new password',
        intro: `Someone (hopefully you) asked to reset your HRMS password. The link works for ${d.minutes} minutes and only once. If it wasn’t you, ignore this message: your password stays the same.`,
        rows: [['Link valid for', `${d.minutes} minutes`]],
        cta: { label: 'Choose a new password', url: d.resetUrl },
        whatsapp: `🔐 *${d.company} HRMS password reset*\nChoose a new password here (valid ${d.minutes} min):\n${d.resetUrl}\nIf you didn’t ask for this, ignore this message.`
      };
    }
  },

  NOTICE_PUBLISHED: {
    group: 'Engagement',
    label: 'Notice published',
    audience: 'Employees in the notice audience',
    defaults: { email: true, whatsapp: false, inApp: true },
    template: {
      name: 'hrms_new_notice',
      body: 'Hello {{1}}, a new notice has been published: {{2}}. {{3}} Read the full notice in the {{company}} HRMS.',
      params: ['recipientName', 'title', 'summary']
    },
    build(d) {
      const summary = String(d.body || '').replace(/\s+/g, ' ').trim();
      const short = summary.length > 180 ? `${summary.slice(0, 177)}…` : summary;
      return {
        vars: { summary: short || 'Open the HRMS for details.' },
        subject: `Notice: ${d.title}`,
        heading: d.title,
        intro: summary || 'A new notice is available on the notice board.',
        rows: d.attachmentName ? [['Attachment', d.attachmentName]] : [],
        cta: { label: 'Open notice board', path: '/notices' },
        whatsapp: `📢 *${d.title}*\n${short}\n\n${d.link}`
      };
    }
  },

  BIRTHDAY_WISH: {
    group: 'Engagement',
    label: 'Birthday wishes',
    audience: 'The employee on their birthday',
    defaults: { email: true, whatsapp: true, inApp: true },
    template: {
      name: 'hrms_birthday_wish',
      body: 'Dear {{1}}, {{2}} Warm wishes from everyone at {{company}}.',
      params: ['recipientName', 'message']
    },
    // message (AI-personalised or fixed), from (optional sender name)
    build(d) {
      const message = d.message || `Wishing you a very happy birthday and a wonderful year ahead!`;
      return {
        subject: `Happy birthday, ${d.recipientName}! 🎂`,
        heading: `Happy birthday, ${d.recipientName}!`,
        intro: message,
        rows: d.from ? [['With wishes from', d.from]] : [],
        cta: null,
        tone: 'celebration',
        whatsapp: `🎂 *Happy birthday, ${d.recipientName}!*\n${message}${d.from ? `\n— ${d.from}` : `\n— Team ${d.company}`}`
      };
    }
  },

  ANNIVERSARY_WISH: {
    group: 'Engagement',
    label: 'Work anniversary wishes',
    audience: 'The employee on their joining anniversary',
    defaults: { email: true, whatsapp: true, inApp: true },
    template: {
      name: 'hrms_work_anniversary',
      body: 'Dear {{1}}, congratulations on completing {{2}} with {{company}}! {{3}} Thank you for being part of our journey.',
      params: ['recipientName', 'yearsLabel', 'message']
    },
    build(d) {
      const yearsLabel = plural(d.years, 'year');
      const message = d.message || `Thank you for your dedication and hard work.`;
      return {
        vars: { yearsLabel },
        subject: `Happy ${yearsLabel} work anniversary, ${d.recipientName}!`,
        heading: `${yearsLabel} with ${d.company}`,
        intro: message,
        rows: d.from ? [['With wishes from', d.from]] : [],
        cta: null,
        tone: 'celebration',
        whatsapp: `🎉 *Happy work anniversary, ${d.recipientName}!*\nYou complete ${yearsLabel} with ${d.company} today.\n${message}`
      };
    }
  },

  CELEBRATIONS_DIGEST: {
    group: 'Engagement',
    label: "Today's birthdays & anniversaries (for HR)",
    audience: 'Super Admin and HR Admin',
    defaults: { email: true, whatsapp: false, inApp: true },
    template: {
      name: 'hrms_celebrations_today',
      body: 'Hello {{1}}, today we celebrate: {{2}}. Wish them on the {{company}} HRMS home page.',
      params: ['recipientName', 'summary']
    },
    build(d) {
      const lines = (d.items || []).map((x) => (x.type === 'BIRTHDAY' ? `${x.name}: birthday` : `${x.name}: ${plural(x.years, 'year')} with us`));
      return {
        vars: { summary: lines.join('; ') },
        subject: `Today's celebrations: ${lines.length}`,
        heading: "Today's celebrations",
        intro: 'Here is who is celebrating today.',
        rows: (d.items || []).map((x) => [x.name, x.type === 'BIRTHDAY' ? 'Birthday' : `${plural(x.years, 'year')} work anniversary`]),
        cta: { label: 'Open HRMS home', path: '/' },
        whatsapp: `🎉 *Today's celebrations*\n${lines.join('\n')}\n\n${d.link}`
      };
    }
  },

  HOLIDAY_REMINDER: {
    group: 'Engagement',
    label: 'Holiday reminder (day before)',
    audience: 'All active employees',
    defaults: { email: false, whatsapp: false, inApp: true },
    template: {
      name: 'hrms_holiday_reminder',
      body: 'Hello {{1}}, a reminder that {{2}} is a holiday on {{3}}. Enjoy the day! Regards, {{company}} HR.',
      params: ['recipientName', 'holidayName', 'dateLabel']
    },
    build(d) {
      return {
        vars: { dateLabel: fmtDay(d.date) },
        subject: `Holiday tomorrow: ${d.holidayName}`,
        heading: `${d.holidayName} · ${fmtDay(d.date)}`,
        intro: `The office and plant follow the holiday calendar for ${d.holidayName}. Please plan hand-overs today.`,
        rows: [['Holiday', d.holidayName], ['Date', fmtDay(d.date)]],
        cta: { label: 'Holiday calendar', path: '/holidays' },
        whatsapp: `🌤️ *Holiday reminder*\n${d.holidayName} is a holiday on ${fmtDay(d.date)}.`
      };
    }
  },

  PROBATION_DUE: {
    group: 'People',
    label: 'Probation confirmation due',
    audience: 'Reporting manager and HR',
    defaults: { email: true, whatsapp: true, inApp: true },
    template: {
      name: 'hrms_probation_due',
      body: 'Hello {{1}}, the probation period of {{2}} ends on {{3}}. Please complete the confirmation review in the {{company}} HRMS.',
      params: ['recipientName', 'employeeName', 'dateLabel']
    },
    build(d) {
      return {
        vars: { dateLabel: fmtDay(d.endDate) },
        subject: `Probation review due: ${d.employeeName}`,
        heading: 'Probation confirmation due',
        intro: `${d.employeeName}'s probation ends on ${fmtDay(d.endDate)}. Confirm, extend or review it.`,
        rows: [['Employee', `${d.employeeName}${d.employeeCode ? ` (${d.employeeCode})` : ''}`], ['Probation ends', fmtDay(d.endDate)]],
        cta: { label: 'Open probation reviews', path: '/probation' },
        whatsapp: `*Probation review due*\n${d.employeeName} · ends ${fmtDay(d.endDate)}\n${d.link}`
      };
    }
  },

  PROBATION_DECIDED: {
    group: 'People',
    label: 'Probation confirmed / extended',
    audience: 'The employee',
    defaults: { email: true, whatsapp: true, inApp: true },
    template: {
      name: 'hrms_probation_decided',
      body: 'Hello {{1}}, {{2}} Regards, {{company}} HR.',
      params: ['recipientName', 'outcomeLine']
    },
    // data: outcome (CONFIRMED | EXTENDED), extendedUntil, remarks
    build(d) {
      const confirmed = d.outcome === 'CONFIRMED';
      const outcomeLine = confirmed
        ? `congratulations, your employment with ${d.company} has been confirmed.`
        : `your probation has been extended until ${fmtDay(d.extendedUntil)}. Your manager will review it again then.`;
      return {
        vars: { outcomeLine },
        subject: confirmed ? `Your employment is confirmed · ${d.company}` : `Probation extended · ${d.company}`,
        heading: confirmed ? 'Employment confirmed' : 'Probation extended',
        tone: confirmed ? 'celebration' : 'neutral',
        intro: `Hello ${d.recipientName}, ${outcomeLine}`,
        rows: [
          ['Outcome', confirmed ? 'Confirmed' : 'Extended'],
          ...(!confirmed && d.extendedUntil ? [['New review date', fmtDay(d.extendedUntil)]] : []),
          ...(d.remarks ? [['Remarks', String(d.remarks).slice(0, 400)]] : [])
        ],
        cta: { label: 'Open my profile', path: '/account' },
        whatsapp: confirmed
          ? `*Employment confirmed* 🎉\nHello ${d.recipientName}, congratulations! Your employment with ${d.company} is now confirmed.\n${d.link}`
          : `*Probation extended*\nHello ${d.recipientName}, your probation has been extended until ${fmtDay(d.extendedUntil)}.\n${d.link}`
      };
    }
  },

  CANDIDATE_UPDATE: {
    group: 'Recruitment',
    label: 'Candidate letters & stage updates',
    audience: 'The candidate',
    defaults: { email: true, whatsapp: true, inApp: false },
    template: {
      name: 'hrms_candidate_update',
      body: 'Dear {{1}}, {{2}} Please check your email for the details. Regards, {{company}} HR.',
      params: ['recipientName', 'message']
    },
    build(d) {
      return {
        subject: d.subject ? `${d.subject} · ${d.company}` : `Update on your application with ${d.company}`,
        heading: d.heading || d.subject || 'Application update',
        intro: `Dear ${d.recipientName}, ${d.message}`,
        rows: [...(d.position ? [['Position', d.position]] : []), ...(d.extraRows || [])],
        cta: d.ctaUrl ? { label: d.ctaLabel || 'Open', url: d.ctaUrl } : null,
        whatsapp: `Dear ${d.recipientName}, ${d.message}`
      };
    }
  },

  ATTENDANCE_MISSING: {
    group: 'Leave & attendance',
    label: 'No check-in by mid-shift',
    audience: 'Employees who have not punched in (no approved leave)',
    defaults: { email: false, whatsapp: false, inApp: true },
    template: {
      name: 'hrms_attendance_missing',
      body: 'Hello {{1}}, we have not received your check-in for {{2}}. If you are on duty, please mark attendance or raise a regularization. Thank you, {{company}} HR.',
      params: ['recipientName', 'dateLabel']
    },
    build(d) {
      return {
        vars: { dateLabel: fmtDay(d.date) },
        subject: `No check-in recorded for ${fmtDay(d.date)}`,
        heading: 'We could not find your check-in',
        intro: `No attendance punch has been recorded for you today (${fmtDay(d.date)}). If you are working, mark attendance or raise a regularization.`,
        rows: [['Date', fmtDay(d.date)], ['Shift', d.shiftName || 'Assigned shift']],
        cta: { label: 'Open attendance', path: '/attendance' },
        whatsapp: `⏰ No check-in recorded for ${fmtDay(d.date)}. If you are on duty, please mark attendance: ${d.link}`
      };
    }
  },

  DAILY_HR_DIGEST: {
    group: 'Leave & attendance',
    label: 'Daily HR digest with AI summary',
    audience: 'Super Admin and HR Admin',
    defaults: { email: false, whatsapp: false, inApp: true },
    template: {
      name: 'hrms_daily_digest',
      body: 'Hello {{1}}, here is today’s summary: {{2}}. Open the {{company}} HRMS dashboard for details.',
      params: ['recipientName', 'summary']
    },
    build(d) {
      return {
        vars: { summary: String(d.summary || '').replace(/\s+/g, ' ').slice(0, 900) },
        subject: `HR digest · ${fmtDay(d.date)}`,
        heading: `Today at ${d.company}`,
        intro: d.summary,
        rows: (d.rows || []),
        cta: { label: 'Open dashboard', path: '/dashboard' },
        whatsapp: `📊 *HR digest · ${fmtDay(d.date)}*\n${d.summary}\n\n${d.link}`
      };
    }
  },

  DOCUMENT_ISSUED: {
    group: 'People',
    label: 'Letter or document issued',
    audience: 'The employee',
    defaults: { email: true, whatsapp: false, inApp: true },
    template: {
      name: 'hrms_document_issued',
      body: 'Hello {{1}}, HR has issued your {{2}}. Please check your email or the {{company}} HRMS to download it.',
      params: ['recipientName', 'documentName']
    },
    build(d) {
      return {
        subject: `${d.documentName} from ${d.company}`,
        heading: d.documentName,
        intro: `HR has issued your ${d.documentName}.${d.attached ? ' The PDF is attached.' : ''}`,
        rows: [],
        cta: { label: 'Open HRMS', path: '/account' },
        whatsapp: `📄 HR has issued your ${d.documentName}. ${d.link}`
      };
    }
  },

  CUSTOM: {
    group: 'Engagement',
    label: 'Messages sent from Message Center',
    audience: 'Chosen by the sender',
    defaults: { email: true, whatsapp: true, inApp: true },
    template: {
      name: 'hrms_general_update',
      body: 'Hello {{1}}, {{2}} Regards, {{company}} HR.',
      params: ['recipientName', 'message']
    },
    build(d) {
      return {
        subject: d.subject || `Message from ${d.company} HR`,
        heading: d.subject || `Message from ${d.company} HR`,
        intro: d.message,
        rows: [],
        cta: d.ctaUrl ? { label: d.ctaLabel || 'Open', url: d.ctaUrl } : null,
        whatsapp: `${d.subject ? `*${d.subject}*\n` : ''}${d.message}`
      };
    }
  }
};

const EVENT_KEYS = Object.keys(EVENTS);

function eventDefaults() {
  return Object.fromEntries(EVENT_KEYS.map((k) => [k, { ...EVENTS[k].defaults }]));
}

function publicCatalogue(companyName = 'JPK') {
  return EVENT_KEYS.map((key) => {
    const e = EVENTS[key];
    return {
      key,
      group: e.group,
      label: e.label,
      audience: e.audience,
      defaults: e.defaults,
      template: { name: e.template.name, body: e.template.body.replace(/\{\{company\}\}/g, companyName), params: e.template.params }
    };
  });
}

module.exports = { EVENTS, EVENT_KEYS, eventDefaults, publicCatalogue, fmtDay, fmtTime, leaveLabel };

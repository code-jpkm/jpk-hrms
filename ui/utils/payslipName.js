// Same name as the server gives (server/src/utils/payslipName.js):
// "Sayantan Mondal Payslip October 2026.pdf".

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthWords(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return String(month || '').trim();
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function cleanPart(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** employee: { firstName, middleName, lastName, employeeCode } (a populated slip.employeeId works). */
export function payslipFileName(employee, month) {
  const e = employee && typeof employee === 'object' ? employee : {};
  const who = (cleanPart([e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ')) || cleanPart(e.employeeCode) || 'Employee').slice(0, 100).trim();
  const when = cleanPart(monthWords(month));
  return `${who} Payslip${when ? ` ${when}` : ''}.pdf`;
}

// File names for payslips: "Sayantan Mondal Payslip October 2026.pdf".
// The website and the phone app build the same name (ui/utils/payslipName.js,
// android-app/src/utils/payslipName.js), so a file is called the same however
// it is downloaded, emailed or sent on WhatsApp.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2026" from "2026-10" (anything else is returned as it is). */
function monthWords(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return String(month || '').trim();
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Leaves out the characters Windows, macOS and phones refuse in a file name. */
function cleanPart(text) {
  return String(text || '')
    .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function personName(employee = {}) {
  return cleanPart([employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(' '));
}

/** "Sayantan Mondal Payslip October 2026.pdf" (the code when there is no name). */
function payslipFileName(employee, month) {
  const who = (personName(employee || {}) || cleanPart(employee?.employeeCode) || 'Employee').slice(0, 100).trim();
  const when = cleanPart(monthWords(month));
  return `${who} Payslip${when ? ` ${when}` : ''}.pdf`;
}

/**
 * Content-Disposition for a download with this name. Browsers use the UTF-8
 * form; the plain one is for old clients (accents dropped, other letters → _).
 */
function attachmentHeader(fileName) {
  const plain = String(fileName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

module.exports = { payslipFileName, attachmentHeader, monthWords };

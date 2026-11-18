const XLSX = require('xlsx');
const ApiError = require('./apiError');

function decodeDataUrl(dataUrl = '') {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new ApiError(400, 'Invalid Excel upload');
  return Buffer.from(match[2], 'base64');
}

/**
 * Rows of the first sheet, keys trimmed.
 *
 * `raw: true` keeps cell values as stored (numbers stay numbers, date cells
 * arrive as Excel serial numbers) instead of the display text. The display
 * text of a date cell depends on its number format — SheetJS renders Excel's
 * built-in date format as US "m/d/yy" — so dates must be read from the serial.
 * The returned array carries `date1904` for workbooks using the Mac epoch.
 */
function readWorkbookRows(dataUrl, { raw = false } = {}) {
  const workbook = XLSX.read(decodeDataUrl(dataUrl), { type: 'buffer', cellDates: false, raw: false });
  const first = workbook.SheetNames[0];
  if (!first) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[first], { defval: '', raw }).map((row) => {
    const clean = {};
    Object.entries(row).forEach(([key, value]) => { clean[String(key).trim()] = typeof value === 'string' ? value.trim() : value; });
    return clean;
  });
  rows.date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  return rows;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function utcDate(year, month, day) {
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function expandYear(year) {
  if (year >= 100) return year;
  const pivot = (new Date().getUTCFullYear() % 100) + 1;
  return year <= pivot ? 2000 + year : 1900 + year;
}

function serialToDate(serial, date1904 = false) {
  const parts = XLSX.SSF.parse_date_code(serial, { date1904 });
  return parts ? utcDate(parts.y, parts.m, parts.d) : null;
}

/**
 * Whole-day value from an import cell, as UTC midnight of that calendar day.
 * Accepts Excel date serials, "YYYY-MM-DD", Indian "DD/MM/YYYY" (also with
 * "-" or "." and 2-digit years) and "05-Apr-2024" / "5 April 2024".
 * Returns undefined for a blank cell and null for anything it cannot read, so
 * the caller can reject the row instead of guessing.
 */
function parseImportDate(value, { date1904 = false } = {}) {
  if (value === '' || value === null || value === undefined) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : utcDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? serialToDate(value, date1904) : null;
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return serialToDate(Number(s), date1904);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return utcDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return utcDate(expandYear(Number(m[3])), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})[-\s/.]+([A-Za-z]{3,9})\.?[-\s/.,]+(\d{2}|\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return utcDate(expandYear(Number(m[3])), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]));
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return utcDate(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  return null;
}

function workbookBuffer({ sheetName = 'Template', headers = [], rows = [], instructions = [] }) {
  const wb = XLSX.utils.book_new();
  const data = rows.length ? rows : [];
  const ws = XLSX.utils.json_to_sheet(data, { header: headers });
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  if (instructions.length) {
    const info = XLSX.utils.aoa_to_sheet([['Instructions'], ...instructions.map((x) => [x])]);
    XLSX.utils.book_append_sheet(wb, info, 'Instructions');
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
}

module.exports = { readWorkbookRows, workbookBuffer, parseImportDate };

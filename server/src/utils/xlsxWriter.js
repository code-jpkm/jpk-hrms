/**
 * Small helpers to write .xlsx files with SheetJS: rows as arrays, column widths,
 * number formats, merged title cells, totals as live formulas, links and a filter
 * on the header row.
 *
 * A cell is a plain value (text, number, null) or an object:
 *   { v, f?, z?, link? }  — value, formula ("SUM(D5:D9)"), number format, web link.
 */
const XLSX = require('xlsx');

function isCellObject(value) {
  return value && typeof value === 'object' && !(value instanceof Date) && ('v' in value || 'f' in value);
}

/**
 * @param {Array<Array>} rows
 * @param {object} options
 *   widths: number[] — column widths in characters
 *   merges: string[] — e.g. ['A1:H1']
 *   filter: string — header range for Excel's filter buttons, e.g. 'A4:H4' or 'A4:H90'
 *   numberFormat: { [columnIndex]: string } — format for every number in that column
 *   formatFromRow: number — first row (0-based) the column formats apply to
 */
function makeSheet(rows, options = {}) {
  const plain = rows.map((row) => row.map((cell) => (isCellObject(cell) ? (cell.v ?? null) : (cell === undefined ? null : cell))));
  const ws = XLSX.utils.aoa_to_sheet(plain);
  const formats = options.numberFormat || {};
  const fromRow = options.formatFromRow || 0;
  rows.forEach((row, r) => row.forEach((cell, c) => {
    const address = XLSX.utils.encode_cell({ r, c });
    if (isCellObject(cell)) {
      if (!ws[address]) ws[address] = { t: typeof cell.v === 'number' ? 'n' : 's', v: cell.v ?? '' };
      if (cell.f) ws[address].f = cell.f;
      if (cell.z) ws[address].z = cell.z;
      if (cell.link) ws[address].l = { Target: cell.link, Tooltip: cell.tooltip || cell.link };
    }
    const target = ws[address];
    if (target && target.t === 'n' && !target.z && r >= fromRow && formats[c]) target.z = formats[c];
  }));
  if (options.widths) ws['!cols'] = options.widths.map((wch) => ({ wch }));
  if (options.merges?.length) ws['!merges'] = options.merges.map((ref) => XLSX.utils.decode_range(ref));
  if (options.filter) ws['!autofilter'] = { ref: options.filter };
  return ws;
}

/** [{ name, rows, ...makeSheet options }] → .xlsx Buffer */
function workbookBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(wb, makeSheet(sheet.rows, sheet), String(sheet.name).slice(0, 31));
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', compression: true });
}

/** Column letter of a 0-based index: 0 → A, 27 → AB. */
function columnLetter(index) {
  return XLSX.utils.encode_col(index);
}

module.exports = { makeSheet, workbookBuffer, columnLetter };

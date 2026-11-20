const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const Tenant = require('../models/Tenant');
const PayslipTemplate = require('../models/PayslipTemplate');
const { payslipLines, rupeesInWords } = require('./payslipModel');

const SAMPLE_FOOTER = '*This is a system generated payslip and does not require signature.';
const OLD_DEFAULT_FOOTERS = ['Computer generated salary slip.', 'Computer generated payslip.', ''];

async function getActivePayslipTemplate(tenantId) {
  const tenant = await Tenant.findById(tenantId);
  let template = await PayslipTemplate.findOne({ tenantId, active: true }).sort('-updatedAt');
  if (!template) {
    template = await PayslipTemplate.create({
      tenantId,
      active: true,
      name: 'JPK payslip',
      companyName: tenant?.name,
      companyAddress: tenant?.salarySlipFormat?.companyAddress || '',
      footerText: tenant?.salarySlipFormat?.footerText || SAMPLE_FOOTER
    });
  }
  return { tenant, template };
}

function employeeName(employee) {
  return `${employee.firstName || ''} ${employee.lastName || ''}`.trim();
}

/** 9480 → "9480"; 1534.45 → "1534.45" (whole rupees print like the JPK sheet, without commas). */
function amountText(value) {
  const v = Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function dayText(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function monthText(month) {
  const [y, m] = String(month || '').split('-').map(Number);
  if (!y || !m) return String(month || '');
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function daysText(value) {
  const v = Number(value || 0);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** "P-15, Bentinck Street, Kolkata 700001" → "Kolkata". */
function cityFromAddress(address) {
  const text = String(address || '').trim();
  if (!text) return '';
  const withPin = text.match(/([A-Za-z][A-Za-z .]*?)[\s,-]*\d{6}\b/);
  const raw = withPin ? withPin[1] : text.split(',').map((p) => p.trim()).filter(Boolean).pop();
  const city = String(raw || '').split(',').pop().trim();
  return city.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function siteFor(tenant, employee) {
  const sites = (tenant?.sites || []).filter((s) => s.active !== false);
  const wanted = employee?.workLocation === 'OFFICE' ? 'OFFICE' : employee?.workLocation === 'FACTORY' ? 'FACTORY' : null;
  return sites.find((s) => s.type === wanted) || sites.find((s) => s.type === 'OFFICE') || sites[0] || null;
}

function locationFor(tenant, employee) {
  const site = siteFor(tenant, employee);
  const city = cityFromAddress(site?.address);
  if (city) return city;
  if (site?.name) return site.name;
  return { OFFICE: 'Office', FACTORY: 'Factory', BOTH: 'Office / Factory' }[employee?.workLocation] || '';
}

function bankAccountText(employee, template) {
  const full = employee?.bankDetails?.salaryAccountNumber || employee?.bankDetails?.accountNumber || '';
  const last4 = full ? full.slice(-4) : employee?.salary?.bankAccountLast4 || '';
  const mode = template?.bankAccountDisplay || 'FULL';
  if (mode === 'HIDE') return '';
  if (mode === 'LAST4') return last4 ? `XXXXXX${last4}` : '';
  return full || (last4 ? `XXXXXX${last4}` : '');
}

/**
 * Draws the payslip in JPK's own format (the Google Sheets payslip): one
 * bordered table with the company heading, employee details in two columns,
 * Earnings / Master / Amount beside Deductions / Amount, totals, net pay and
 * the amount in words, then the "system generated" line under the box.
 */
function drawPayslip(doc, { tenant, template, slip }) {
  const e = slip.employeeId || {};
  const view = payslipLines(slip);
  const company = template.companyName || tenant?.name || 'Company';
  const officeAddress = (tenant?.sites || []).find((s) => s.type === 'OFFICE' && s.address)?.address || '';
  const address = template.companyAddress || tenant?.salarySlipFormat?.companyAddress || officeAddress;
  const footer = OLD_DEFAULT_FOOTERS.includes(String(template.footerText || '').trim()) ? SAMPLE_FOOTER : template.footerText;

  // Measured from JPK's own payslip (A4, points): box 50–547.6, divider at 335,
  // Times 8.2 pt text, 10.2 pt bold headings.
  const L = 50;
  const R = 547.6;
  const W = R - L;
  const DIV = 335;
  const SIZE = 8.2;
  const ink = '#000000';
  const font = (bold, size = SIZE) => doc.font(bold ? 'Times-Bold' : 'Times-Roman').fontSize(size);
  const line = (x1, y1, x2, y2) => doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(0.6).strokeColor(ink).stroke();
  const right = (text, edge, y, width = 80) => doc.text(text, edge - width, y, { width, align: 'right', lineBreak: false });
  doc.fillColor(ink);

  // Heading
  const top = 53.7;
  font(true, 10.2).text(company, L, top + 4, { width: W, align: 'center', lineBreak: false });
  let y = top + 17;
  if (address) {
    font(false).text(address, L + 10, y, { width: W - 20, align: 'center' });
    y += Math.max(10.4, doc.heightOfString(address, { width: W - 20 }) + 2.4);
  } else {
    y += 2;
  }
  font(true, 10.2).text(`Payslip for the month of ${monthText(slip.month)}`, L, y, { width: W, align: 'center', lineBreak: false });
  y += 9.9;
  line(L, y, R, y);

  // Employee details: two columns of label / value
  const leftRows = [
    ['Name:', employeeName(e)],
    ['Joining Date:', dayText(e.dateOfJoining)],
    ['Designation:', e.designation || ''],
    ['Department:', e.department || ''],
    ['Location:', locationFor(tenant, e)]
  ];
  if (template.showAttendanceSummary !== false) {
    leftRows.push(['Effective Work Days:', daysText(view.info.payableDays)]);
    leftRows.push(['LOP:', daysText(view.info.lopDays)]);
  }
  const rightRows = [
    ['Employee No:', e.employeeCode || ''],
    ['Bank Name:', e.bankDetails?.salaryBankName || e.bankDetails?.bankName || ''],
    ['Bank Account No:', bankAccountText(e, template)],
    ['PAN Number:', e.statutory?.pan || e.salary?.pan || '']
  ];
  if (template.showPfEsiNumbers !== false) {
    rightRows.push(['PF No:', e.statutory?.pfNumber || e.salary?.pfNumber || '']);
    rightRows.push(['PF UAN:', e.statutory?.uan || '']);
  }
  const infoRows = Math.max(leftRows.length, rightRows.length);
  const infoStep = 9.38;
  y += 3.7;
  font(false);
  for (let i = 0; i < infoRows; i += 1) {
    const ry = y + i * infoStep;
    if (leftRows[i]) {
      doc.text(leftRows[i][0], 52, ry, { width: 170, lineBreak: false });
      doc.text(leftRows[i][1], 227.9, ry, { width: 105, lineBreak: false, ellipsis: true });
    }
    if (rightRows[i]) {
      doc.text(rightRows[i][0], 337.2, ry, { width: 100, lineBreak: false });
      doc.text(rightRows[i][1], 440.9, ry, { width: R - 440.9 - 2, lineBreak: false, ellipsis: true });
    }
  }
  const tableTop = y + (infoRows - 1) * infoStep + 8.8;
  line(L, tableTop, R, tableTop);

  // Column edges
  const masterRight = 266.1;
  const amountRight = 331.5;
  const dedLeft = 335.2;
  const dedRight = 543.3;

  // Table heading
  y = tableTop + 2.5;
  font(true);
  doc.text('Earnings', 52, y, { lineBreak: false });
  right('Master', masterRight, y);
  right('Amount', amountRight, y);
  doc.text('Deductions', DIV, y, { width: 145.2, align: 'center', lineBreak: false });
  right('Amount', dedRight, y);
  const headLine = tableTop + 11.7;
  line(L, headLine, R, headLine);

  // Lines
  const earnings = [
    ...view.earnings.map((l) => ({ label: l.label, master: l.master, amount: l.amount })),
    ...view.extraEarnings.map((l) => ({ label: l.label, master: null, amount: l.amount }))
  ];
  const deductions = [
    ...view.deductions.map((l) => ({ label: l.label, amount: l.amount })),
    ...view.extraDeductions.map((l) => ({ label: l.label, amount: l.amount }))
  ];
  const rows = Math.max(earnings.length, deductions.length, 4);
  const rowStep = 12.03;
  y = headLine + 3.8;
  font(false);
  for (let i = 0; i < rows; i += 1) {
    const ry = y + i * rowStep;
    const er = earnings[i];
    const dr = deductions[i];
    if (er) {
      doc.text(er.label, 52, ry, { width: 150, lineBreak: false, ellipsis: true });
      if (er.master !== null && er.master !== undefined) right(amountText(er.master), masterRight, ry);
      right(amountText(er.amount), amountRight, ry);
    }
    if (dr) {
      doc.text(dr.label, dedLeft, ry, { width: 140, lineBreak: false, ellipsis: true });
      right(amountText(dr.amount), dedRight, ry);
    }
  }
  const totalsLine = y + (rows - 1) * rowStep + 19.1;
  line(L, totalsLine, R, totalsLine);

  // Totals
  y = totalsLine + 4;
  doc.text('Total Earnings', 52, y, { lineBreak: false });
  right(amountText(view.totals.master), masterRight, y);
  right(amountText(view.totals.earnings), amountRight, y);
  doc.text('Total Deductions', dedLeft, y, { lineBreak: false });
  right(amountText(view.totals.deductions), dedRight, y);
  const netLine = totalsLine + 13.1;
  line(L, netLine, R, netLine);
  line(DIV, tableTop, DIV, netLine);

  // Net pay and the amount in words
  y = netLine + 2.9;
  doc.text('Net Pay for the Month', 52, y, { lineBreak: false });
  font(true);
  right(amountText(slip.netPay), amountRight, y, 100);
  font(false);
  y += 17.7;
  const words = `(${rupeesInWords(slip.netPay)})`;
  doc.text(words, 52, y, { width: W - 4 });
  y += doc.heightOfString(words, { width: W - 4 });
  if (view.notes) {
    y += 3;
    const note = `Note: ${view.notes}`;
    doc.text(note, 52, y, { width: W - 4 });
    y += doc.heightOfString(note, { width: W - 4 });
  }
  const bottom = y - 1;
  doc.rect(L, top, W, bottom - top).lineWidth(0.6).strokeColor(ink).stroke();

  if (footer) {
    doc.font('Helvetica').fontSize(6.8).fillColor(ink).text(footer, L, bottom + 3.7, { width: W, align: 'center' });
  }
}

async function writePayslipPdfToStream({ tenantId, slip, stream }) {
  const { tenant, template } = await getActivePayslipTemplate(tenantId);
  const doc = new PDFDocument({ margin: 0, size: 'A4', info: { Title: `${employeeName(slip.employeeId || {})} ${slip.month}`, Author: template.companyName || tenant?.name || 'HRMS' } });
  doc.pipe(stream);
  drawPayslip(doc, { tenant, template, slip });
  doc.end();
}

async function payslipPdfBuffer({ tenantId, slip }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = new PassThrough();
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    writePayslipPdfToStream({ tenantId, slip, stream }).catch(reject);
  });
}

module.exports = { getActivePayslipTemplate, writePayslipPdfToStream, payslipPdfBuffer, drawPayslip, cityFromAddress, amountText };

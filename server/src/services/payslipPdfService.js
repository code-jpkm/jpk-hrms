const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const Tenant = require('../models/Tenant');
const PayslipTemplate = require('../models/PayslipTemplate');

async function getActivePayslipTemplate(tenantId) {
  const tenant = await Tenant.findById(tenantId);
  let template = await PayslipTemplate.findOne({ tenantId, active: true }).sort('-updatedAt');
  if (!template) {
    template = await PayslipTemplate.create({
      tenantId,
      active: true,
      name: 'Default Payslip Format',
      companyName: tenant?.name,
      companyAddress: tenant?.salarySlipFormat?.companyAddress || '',
      footerText: tenant?.salarySlipFormat?.footerText || 'Computer generated salary slip.',
      earningsLabels: [{ key: 'basic', label: 'Basic' }, { key: 'hra', label: 'HRA' }, { key: 'conveyance', label: 'Conv.' }, { key: 'specialAllowance', label: 'Spl Allowance' }, { key: 'proratedGross', label: 'Gross Payable' }],
      deductionLabels: [{ key: 'pf', label: 'PF' }, { key: 'esi', label: 'ESI' }, { key: 'ptax', label: 'Professional Tax' }, { key: 'total', label: 'Total Deductions' }]
    });
  }
  return { tenant, template };
}

function money(v) {
  return Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function employeeName(employee) {
  return `${employee.firstName || ''} ${employee.lastName || ''}`.trim();
}

async function writePayslipPdfToStream({ tenantId, slip, stream }) {
  const { tenant, template } = await getActivePayslipTemplate(tenantId);
  const doc = new PDFDocument({ margin: 42, size: 'A4' });
  doc.pipe(stream);

  const primary = template.primaryColor || '#1F3445';
  const companyName = template.companyName || tenant?.name || 'Company';
  doc.rect(0, 0, doc.page.width, 92).fill(primary);
  doc.fillColor('white').fontSize(20).text(companyName, 42, 26, { align: 'center' });
  if (template.companyAddress) doc.fontSize(9).text(template.companyAddress, { align: 'center' });
  if (template.headerText) doc.fontSize(9).text(template.headerText, { align: 'center' });
  doc.fillColor('black').moveDown(3);

  doc.fontSize(16).text(`Salary Slip - ${slip.month}`, { align: 'center' });
  doc.moveDown(0.8);
  const e = slip.employeeId || {};
  doc.fontSize(11);
  doc.text(`Employee: ${employeeName(e)}`);
  doc.text(`Code: ${e.employeeCode || '-'}`);
  doc.text(`Department: ${e.department || '-'}`);
  doc.text(`Designation: ${e.designation || '-'}`);
  if (template.showBankLast4 && e.salary?.bankAccountLast4) doc.text(`Bank Account: ****${e.salary.bankAccountLast4}`);
  if (template.showPfEsiNumbers) {
    if (e.salary?.pfNumber) doc.text(`PF No: ${e.salary.pfNumber}`);
    if (e.salary?.esiNumber) doc.text(`ESI No: ${e.salary.esiNumber}`);
  }
  doc.moveDown(0.8);

  if (template.showAttendanceSummary !== false) {
    doc.fontSize(13).fillColor(primary).text('Attendance Summary');
    doc.fillColor('black').fontSize(10);
    const st = slip.attendanceStats || {};
    doc.text(`Working Days: ${st.workingDays || 0}    Payable Days: ${st.payableDays || 0}    Present: ${st.presentDays || 0}    WFH: ${st.wfhDays || 0}    Leave: ${st.leaveDays || 0}    Absent: ${st.absentDays || 0}`);
    doc.moveDown(0.8);
  }

  const leftX = 42;
  const rightX = 320;
  const y = doc.y;
  doc.fontSize(13).fillColor(primary).text('Earnings', leftX, y);
  doc.text('Deductions', rightX, y);
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('black');
  const startY = doc.y;
  let ly = startY;
  const earningsLabels = template.earningsLabels?.length ? template.earningsLabels : [{ key: 'basic', label: 'Basic' }, { key: 'hra', label: 'HRA' }, { key: 'conveyance', label: 'Conv.' }, { key: 'specialAllowance', label: 'Spl Allowance' }, { key: 'proratedGross', label: 'Gross Payable' }];
  for (const row of earningsLabels) {
    doc.text(row.label || row.key, leftX, ly);
    doc.text(money(slip.earnings?.[row.key] || slip.earnings?.custom?.[row.key] || 0), leftX + 145, ly, { width: 90, align: 'right' });
    ly += 18;
  }
  let ry = startY;
  const deductionLabels = template.deductionLabels?.length ? template.deductionLabels : [{ key: 'pf', label: 'PF' }, { key: 'esi', label: 'ESI' }, { key: 'ptax', label: 'Professional Tax' }, { key: 'total', label: 'Total Deductions' }];
  for (const row of deductionLabels) {
    doc.text(row.label || row.key, rightX, ry);
    doc.text(money(slip.deductions?.[row.key] || slip.deductions?.custom?.[row.key] || 0), rightX + 145, ry, { width: 90, align: 'right' });
    ry += 18;
  }
  doc.y = Math.max(ly, ry) + 12;

  if (template.customLines?.length) {
    doc.fontSize(11).fillColor(primary).text('Custom Notes');
    doc.fillColor('black').fontSize(10);
    template.customLines.forEach((line) => doc.text(`${line.label}: ${line.value}`));
    doc.moveDown(0.5);
  }

  doc.moveDown(0.4);
  doc.rect(42, doc.y, doc.page.width - 84, 34).fill('#f1f5f9');
  doc.fillColor('black').fontSize(15).text(`Net Pay: Rs. ${money(slip.netPay)}`, 52, doc.y + 9, { align: 'right', width: doc.page.width - 104 });
  if (template.footerText) {
    doc.fontSize(9).fillColor('#555').text(template.footerText, 42, doc.page.height - 66, { align: 'center' });
  }
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

module.exports = { getActivePayslipTemplate, writePayslipPdfToStream, payslipPdfBuffer };

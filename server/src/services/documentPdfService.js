const PDFDocument = require('pdfkit');
const Tenant = require('../models/Tenant');
const { formatIndianDate } = require('../utils/date');

function writeLine(doc, label, value) {
  doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(value || '-');
}

async function writeEmployeeLetterToStream({ tenantId, employee, type, stream, includeSalary = false }) {
  const tenant = await Tenant.findById(tenantId);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(stream);
  const title = type === 'joining' ? 'JOINING LETTER' : 'OFFER LETTER';
  const name = `${employee.firstName} ${employee.lastName || ''}`.trim();
  doc.fontSize(18).font('Helvetica-Bold').text(tenant?.name || 'Company', { align: 'center' });
  doc.fontSize(10).font('Helvetica').text(tenant?.salarySlipFormat?.companyAddress || '', { align: 'center' });
  doc.moveDown(2);
  doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'center', underline: true });
  doc.moveDown(2);
  doc.fontSize(11).font('Helvetica').text(`Date: ${formatIndianDate(new Date())}`);
  doc.moveDown();
  doc.text(`Dear ${name},`);
  doc.moveDown();
  if (type === 'joining') {
    doc.text(`This confirms that you have joined ${tenant?.name || 'the company'} as ${employee.designation || 'Employee'} in ${employee.department || 'your department'}. Your date of joining is ${employee.dateOfJoining ? formatIndianDate(employee.dateOfJoining) : '-'} and your employee code is ${employee.employeeCode}.`);
  } else {
    doc.text(`We are pleased to offer you the position of ${employee.designation || 'Employee'} in ${employee.department || 'your department'} at ${tenant?.name || 'the company'}. Your expected date of joining is ${employee.dateOfJoining ? formatIndianDate(employee.dateOfJoining) : '-'}.`);
  }
  doc.moveDown();
  writeLine(doc, 'Employee Code', employee.employeeCode);
  writeLine(doc, 'Designation', employee.designation);
  writeLine(doc, 'Department', employee.department);
  if (includeSalary) writeLine(doc, 'Gross Salary (monthly)', employee.salary?.gross ? `Rs. ${Number(employee.salary.gross).toLocaleString('en-IN')}` : '-');
  doc.moveDown(2);
  doc.text('This is a system-generated document from the HRMS employee self-service portal. Authorized HR may replace this default format with company letterhead before production use.');
  doc.moveDown(4);
  doc.text('Authorized Signatory');
  doc.end();
}

module.exports = { writeEmployeeLetterToStream };

const PDFDocument = require('pdfkit');
const Tenant = require('../models/Tenant');
const { formatIndianDate } = require('../utils/date');

async function buildRecruitmentLetterBuffer({ tenantId, candidate, kind }) {
  const tenant = await Tenant.findById(tenantId);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const company = tenant?.name || 'Company';
    const title = kind === 'joining' ? 'JOINING LETTER' : 'OFFER LETTER';
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#17365d').text(company, { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor('#555').text(tenant?.salarySlipFormat?.companyAddress || '', { align: 'center' });
    doc.moveDown(2);
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#111').text(title, { align: 'center', underline: true });
    doc.moveDown(1.5);
    doc.fontSize(10).font('Helvetica').text(`Date: ${formatIndianDate(new Date())}`, { align: 'right' });
    doc.moveDown(1.5);
    doc.fontSize(11).text(`Dear ${candidate.name},`);
    doc.moveDown();
    if (kind === 'joining') {
      doc.text(`Welcome to ${company}. This letter confirms your joining for the position of ${candidate.offer?.designation || candidate.position || 'Employee'}${candidate.offer?.department ? ` in ${candidate.offer.department}` : ''}.`);
      if (candidate.joining?.joinedAt) doc.text(`Your joining date is ${formatIndianDate(candidate.joining.joinedAt)}.`);
    } else {
      doc.text(`We are pleased to offer you the position of ${candidate.offer?.designation || candidate.position || 'Employee'}${candidate.offer?.department ? ` in ${candidate.offer.department}` : ''} at ${company}.`);
      if (candidate.offer?.joiningDate) doc.text(`Your proposed joining date is ${formatIndianDate(candidate.offer.joiningDate)}.`);
      if (candidate.offer?.ctc) doc.text(`Your proposed CTC is ${candidate.offer.ctc}.`);
    }
    doc.moveDown();
    doc.text('Please contact HR for detailed terms and conditions, document submission, and onboarding formalities.');
    doc.moveDown(3);
    doc.text('Regards,');
    doc.text('HR Department');
    doc.text(company);
    doc.end();
  });
}

module.exports = { buildRecruitmentLetterBuffer };

const PDFDocument = require('pdfkit');
const Tenant = require('../models/Tenant');
const DocumentTemplate = require('../models/DocumentTemplate');

const PAGE_SIZES = {
  A4: [595.28, 841.89],
  LETTER: [612, 792],
  LEGAL: [612, 1008]
};

function money(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fullName(person) {
  if (!person) return '';
  return `${person.firstName || ''} ${person.lastName || ''}`.trim();
}

/**
 * The merge-token catalogue. Every key here is offered in the designer's token
 * picker, so the two can never drift apart — the UI reads this same list via
 * GET /api/document-templates/tokens.
 */
function buildContext({ tenant, employee, slip, candidate, extra = {} }) {
  const now = new Date();
  const e = employee || {};
  const s = slip || {};
  const earnings = s.earnings || {};
  const deductions = s.deductions || {};
  const stats = s.attendanceStats || {};

  return {
    company: {
      name: tenant?.name || '',
      address: tenant?.salarySlipFormat?.companyAddress || '',
      footer: tenant?.salarySlipFormat?.footerText || ''
    },
    employee: {
      fullName: fullName(e),
      firstName: e.firstName || '',
      lastName: e.lastName || '',
      code: e.employeeCode || '',
      department: e.department || '',
      designation: e.designation || '',
      email: e.email || '',
      phone: e.phone || '',
      workLocation: e.workLocation || '',
      category: e.employeeCategory || '',
      dateOfJoining: shortDate(e.dateOfJoining),
      status: e.status || '',
      pfNumber: e.salary?.pfNumber || '',
      esiNumber: e.salary?.esiNumber || '',
      pan: e.salary?.pan || '',
      bankLast4: e.salary?.bankAccountLast4 ? `****${e.salary.bankAccountLast4}` : '',
      grossSalary: money(e.salary?.gross)
    },
    candidate: {
      fullName: fullName(candidate) || candidate?.name || '',
      email: candidate?.email || '',
      phone: candidate?.phone || '',
      appliedFor: candidate?.jobTitle || ''
    },
    slip: {
      month: s.month || '',
      basic: money(earnings.basic),
      hra: money(earnings.hra),
      conveyance: money(earnings.conveyance),
      specialAllowance: money(earnings.specialAllowance),
      otherEarnings: money(earnings.otherEarnings),
      gross: money(earnings.gross),
      proratedGross: money(earnings.proratedGross),
      pf: money(deductions.pf),
      esi: money(deductions.esi),
      ptax: money(deductions.ptax),
      totalDeductions: money(deductions.total),
      netPay: money(s.netPay),
      workingDays: stats.workingDays ?? '-',
      payableDays: stats.payableDays ?? '-',
      lopDays: stats.attendanceLopDays ?? 0,
      presentDays: stats.presentDays ?? '-'
    },
    date: {
      today: shortDate(now),
      day: String(now.getDate()).padStart(2, '0'),
      month: now.toLocaleDateString('en-IN', { month: 'long' }),
      year: String(now.getFullYear())
    },
    ...extra
  };
}

const TOKEN_CATALOGUE = [
  { group: 'Company', tokens: ['company.name', 'company.address', 'company.footer'] },
  { group: 'Employee', tokens: ['employee.fullName', 'employee.firstName', 'employee.lastName', 'employee.code', 'employee.department', 'employee.designation', 'employee.email', 'employee.phone', 'employee.workLocation', 'employee.category', 'employee.dateOfJoining', 'employee.status', 'employee.pfNumber', 'employee.esiNumber', 'employee.pan', 'employee.bankLast4', 'employee.grossSalary'] },
  { group: 'Candidate', tokens: ['candidate.fullName', 'candidate.email', 'candidate.phone', 'candidate.appliedFor'] },
  { group: 'Salary slip', tokens: ['slip.month', 'slip.basic', 'slip.hra', 'slip.conveyance', 'slip.specialAllowance', 'slip.otherEarnings', 'slip.gross', 'slip.proratedGross', 'slip.pf', 'slip.esi', 'slip.ptax', 'slip.totalDeductions', 'slip.netPay', 'slip.workingDays', 'slip.payableDays', 'slip.lopDays', 'slip.presentDays'] },
  { group: 'Date', tokens: ['date.today', 'date.day', 'date.month', 'date.year'] }
];

function lookup(context, path) {
  return String(path).split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), context);
}

/** Replace every {{token}} in a string. Unknown tokens render as an empty string. */
function resolveTokens(text, context) {
  if (!text) return '';
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path) => {
    const value = lookup(context, path);
    return value === undefined || value === null ? '' : String(value);
  });
}

function fontFor(doc, block) {
  if (block.bold && block.italic) return 'Helvetica-BoldOblique';
  if (block.bold) return 'Helvetica-Bold';
  if (block.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

function drawBoxDecoration(doc, block) {
  const hasBg = block.background && block.background !== 'transparent';
  const hasBorder = block.borderWidth > 0 && block.borderColor;
  if (!hasBg && !hasBorder) return;
  doc.save();
  doc.rect(block.x, block.y, block.w, block.h);
  if (hasBg && hasBorder) doc.fillAndStroke(block.background, block.borderColor);
  else if (hasBg) doc.fill(block.background);
  else { doc.lineWidth(block.borderWidth); doc.stroke(block.borderColor); }
  doc.restore();
}

function drawText(doc, block, context, sizeOverride) {
  const pad = Number(block.padding || 0);
  doc.save();
  doc.font(fontFor(doc, block))
    .fontSize(sizeOverride || block.fontSize || 11)
    .fillColor(block.color || '#1f2937');
  doc.text(resolveTokens(block.text, context), block.x + pad, block.y + pad, {
    width: Math.max(1, block.w - pad * 2),
    height: Math.max(1, block.h - pad * 2),
    align: block.align || 'left',
    lineGap: Number(block.lineGap || 2),
    ellipsis: false
  });
  doc.restore();
}

function drawFieldGrid(doc, block, context) {
  const fields = (block.fields || []).filter((f) => f && (f.label || f.value));
  if (!fields.length) return;
  const size = block.fontSize || 10;
  const rowH = size + 8;
  const labelW = block.w * 0.42;
  doc.save();
  fields.forEach((field, i) => {
    const y = block.y + i * rowH;
    if (y + rowH > block.y + block.h + rowH) return;
    doc.font('Helvetica').fontSize(size).fillColor('#6b7280');
    doc.text(resolveTokens(field.label, context), block.x, y, { width: labelW });
    doc.font('Helvetica-Bold').fontSize(size).fillColor(block.color || '#1f2937');
    doc.text(resolveTokens(field.value, context), block.x + labelW, y, { width: block.w - labelW, align: 'left' });
  });
  doc.restore();
}

function drawTable(doc, block, context, headerFill) {
  const rows = (block.rows || []).filter((r) => Array.isArray(r) && r.length);
  if (!rows.length) return;
  const size = block.fontSize || 10;
  const rowH = size + 10;
  const cols = Math.max(...rows.map((r) => r.length));
  const colW = block.w / cols;
  doc.save();
  rows.forEach((row, ri) => {
    const y = block.y + ri * rowH;
    const isHeader = ri === 0;
    if (isHeader && headerFill) {
      doc.rect(block.x, y, block.w, rowH).fill(headerFill);
    }
    row.forEach((cell, ci) => {
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor(isHeader && headerFill ? '#ffffff' : (block.color || '#1f2937'));
      doc.text(resolveTokens(cell, context), block.x + ci * colW + 6, y + 5, {
        width: colW - 12,
        align: ci === 0 ? 'left' : 'right'
      });
    });
    if (block.borderWidth > 0) {
      doc.lineWidth(block.borderWidth).strokeColor(block.borderColor || '#e5e7eb');
      doc.rect(block.x, y, block.w, rowH).stroke();
    }
  });
  doc.restore();
}

/**
 * EARNINGS_TABLE expands from the live slip rather than from stored rows, so a
 * payslip template keeps working when payroll components change. It also renders
 * the LOP waterfall breakdown, which is the whole point of the v25 salary engine:
 * the employee can see which allowance absorbed the loss of pay.
 */
function drawEarningsTable(doc, block, context, slip) {
  const size = block.fontSize || 10;
  const rowH = size + 10;
  const halfW = block.w / 2;
  const accent = block.borderColor || '#1F3445';
  const e = slip?.earnings || {};
  const d = slip?.deductions || {};

  const earnRows = [
    ['Basic', money(e.basic)],
    ['HRA', money(e.hra)],
    ['Conveyance', money(e.conveyance)],
    ['Special Allowance', money(e.specialAllowance)],
    ['Other Earnings', money(e.otherEarnings)]
  ].filter((r) => Number(String(r[1]).replace(/,/g, '')) !== 0);
  // Lines HR added on the payslip (bonus, arrears…) and rule-based extra earnings, so the table foots to net pay.
  for (const [name, amount] of Object.entries(e.custom || {})) if (Number(amount)) earnRows.push([name, money(amount)]);
  for (const line of e.extra || []) earnRows.push([line.label, money(line.amount)]);
  earnRows.push(['Gross Earnings', money(e.total ?? e.proratedGross ?? e.gross)]);

  const dedRows = [
    ['Provident Fund', money(d.pf)],
    ['ESI', money(d.esi)],
    ['Professional Tax', money(d.ptax)],
    ['Loan', money(d.loan)]
  ].filter((r) => Number(String(r[1]).replace(/,/g, '')) !== 0);
  for (const [name, amount] of Object.entries(d.custom || {})) dedRows.push([name, money(amount)]);
  for (const line of d.extra || []) dedRows.push([line.label, money(line.amount)]);
  dedRows.push(['Total Deductions', money(d.total)]);

  doc.save();
  const drawColumn = (rows, x, heading) => {
    doc.rect(x, block.y, halfW, rowH).fill(accent);
    doc.font('Helvetica-Bold').fontSize(size).fillColor('#ffffff');
    doc.text(heading, x + 6, block.y + 5, { width: halfW - 12 });
    rows.forEach((row, i) => {
      const y = block.y + (i + 1) * rowH;
      const last = i === rows.length - 1;
      doc.font(last ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor('#1f2937');
      doc.text(row[0], x + 6, y + 5, { width: halfW * 0.6 });
      doc.text(row[1], x + halfW * 0.6, y + 5, { width: halfW * 0.4 - 6, align: 'right' });
      doc.lineWidth(0.5).strokeColor('#e5e7eb');
      doc.moveTo(x, y + rowH).lineTo(x + halfW, y + rowH).stroke();
    });
  };
  drawColumn(earnRows, block.x, 'EARNINGS');
  drawColumn(dedRows, block.x + halfW, 'DEDUCTIONS');

  const bodyRows = Math.max(earnRows.length, dedRows.length);
  let cursor = block.y + (bodyRows + 1) * rowH + 6;

  doc.rect(block.x, cursor, block.w, rowH + 4).fill('#f3f4f6');
  doc.font('Helvetica-Bold').fontSize(size + 1).fillColor('#111827');
  doc.text('NET PAYABLE', block.x + 6, cursor + 6, { width: block.w * 0.6 });
  doc.text(money(slip?.netPay), block.x + block.w * 0.6, cursor + 6, { width: block.w * 0.4 - 6, align: 'right' });
  cursor += rowH + 12;

  const breakdown = slip?.lopBreakdown || slip?.lop?.breakdown;
  if (Array.isArray(breakdown) && breakdown.length) {
    const labels = { specialAllowance: 'Special Allowance', conveyance: 'Conveyance', hra: 'HRA', otherEarnings: 'Other Earnings', basic: 'Basic' };
    doc.font('Helvetica-Bold').fontSize(size - 1).fillColor('#6b7280');
    doc.text('LOSS OF PAY ADJUSTMENT', block.x, cursor, { width: block.w });
    cursor += size + 4;
    doc.font('Helvetica').fontSize(size - 1).fillColor('#4b5563');
    const line = breakdown.map((b) => `${labels[b.component] || b.component} -${money(b.deducted)}`).join('   |   ');
    doc.text(line, block.x, cursor, { width: block.w });
  }
  doc.restore();
}

function drawSignature(doc, block, context) {
  doc.save();
  doc.lineWidth(0.8).strokeColor(block.borderColor || '#9ca3af');
  const lineY = block.y + block.h - 16;
  doc.moveTo(block.x, lineY).lineTo(block.x + Math.min(block.w, 180), lineY).stroke();
  doc.font('Helvetica').fontSize(block.fontSize || 10).fillColor(block.color || '#4b5563');
  doc.text(resolveTokens(block.text || 'Authorised Signatory', context), block.x, lineY + 4, { width: block.w, align: block.align || 'left' });
  doc.restore();
}

function renderBlock(doc, block, context, slip) {
  switch (block.kind) {
    case 'SPACER':
      return;
    case 'DIVIDER':
      doc.save();
      doc.lineWidth(block.borderWidth || 1).strokeColor(block.borderColor || block.color || '#d1d5db');
      doc.moveTo(block.x, block.y).lineTo(block.x + block.w, block.y).stroke();
      doc.restore();
      return;
    case 'IMAGE':
      if (!block.imageDataUrl) return;
      try {
        const base64 = String(block.imageDataUrl).split(',')[1] || '';
        doc.image(Buffer.from(base64, 'base64'), block.x, block.y, { fit: [block.w, block.h], align: 'center', valign: 'center' });
      } catch (error) {
        // A corrupt logo must never break payroll delivery.
      }
      return;
    case 'FIELD_GRID':
      drawBoxDecoration(doc, block);
      drawFieldGrid(doc, block, context);
      return;
    case 'TABLE':
      drawTable(doc, block, context, block.background || null);
      return;
    case 'EARNINGS_TABLE':
      drawEarningsTable(doc, block, context, slip);
      return;
    case 'SIGNATURE':
      drawSignature(doc, block, context);
      return;
    case 'HEADING':
      drawBoxDecoration(doc, block);
      drawText(doc, block, context, block.fontSize || 18);
      return;
    case 'TEXT':
    default:
      drawBoxDecoration(doc, block);
      drawText(doc, block, context);
  }
}

function writeWatermark(doc, template) {
  if (!template.watermarkText) return;
  doc.save();
  doc.rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.font('Helvetica-Bold').fontSize(64)
    .fillColor('#000000', Number(template.watermarkOpacity ?? 0.08));
  doc.text(template.watermarkText, 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center' });
  doc.restore();
}

/** Render a template to a stream. Blocks paint in Y order so overlaps are predictable. */
async function renderTemplateToStream({ template, context, slip, stream }) {
  const size = PAGE_SIZES[template.pageSize] || PAGE_SIZES.A4;
  const doc = new PDFDocument({
    size: template.orientation === 'landscape' ? [size[1], size[0]] : size,
    margin: 0
  });
  doc.pipe(stream);

  writeWatermark(doc, template);

  const blocks = [...(template.blocks || [])].sort((a, b) => (a.y || 0) - (b.y || 0));
  for (const block of blocks) {
    try {
      renderBlock(doc, block, context, slip);
    } catch (error) {
      // One bad block should not abort the whole document.
      console.warn(`[templateRender] block ${block.id} (${block.kind}) failed: ${error.message}`);
    }
  }

  if (template.showPageNumbers) {
    doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
    doc.text('Page 1', 0, doc.page.height - 26, { width: doc.page.width, align: 'center' });
  }

  doc.end();
}

async function renderTemplateToBuffer({ template, context, slip }) {
  const { PassThrough } = require('stream');
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
  await renderTemplateToStream({ template, context, slip, stream });
  return done;
}

async function getActiveTemplate({ tenantId, type }) {
  return DocumentTemplate.findOne({ tenantId, type, active: true }).sort('-updatedAt');
}

module.exports = {
  buildContext,
  resolveTokens,
  renderTemplateToStream,
  renderTemplateToBuffer,
  getActiveTemplate,
  TOKEN_CATALOGUE,
  PAGE_SIZES,
  money,
  shortDate
};

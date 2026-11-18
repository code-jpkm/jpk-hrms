const mongoose = require('mongoose');

/**
 * A drag-and-drop document template.
 *
 * Blocks are absolutely positioned in PDF points on the page, which is why the
 * designer canvas and the PDF renderer agree pixel-for-pixel: the canvas simply
 * draws the same coordinates at a scale factor. A4 is 595.28 x 841.89 pt.
 *
 * Any block's text may contain merge tokens like {{employee.firstName}} or
 * {{slip.netPay}} — see services/templateRenderService.js for the full catalogue.
 */

const BLOCK_KINDS = [
  'HEADING',        // large title text
  'TEXT',           // paragraph, wraps inside its box
  'FIELD_GRID',     // two-column label/value list
  'EARNINGS_TABLE', // payslip earnings vs deductions, expands dynamically
  'TABLE',          // static rows/columns, tokens allowed in every cell
  'IMAGE',          // logo / signature image from a data URL
  'DIVIDER',        // horizontal rule
  'SIGNATURE',      // signature line with a caption
  'SPACER'          // invisible, for layout only
];

const blockSchema = new mongoose.Schema({
  id: { type: String, required: true },
  kind: { type: String, enum: BLOCK_KINDS, required: true },

  // Geometry, in PDF points, origin at the top-left of the page.
  x: { type: Number, default: 40 },
  y: { type: Number, default: 40 },
  w: { type: Number, default: 515 },
  h: { type: Number, default: 24 },

  // Content
  text: { type: String, default: '' },
  imageDataUrl: String,
  rows: [[String]],
  fields: [{ label: String, value: String }],

  // Presentation
  fontSize: { type: Number, default: 11 },
  bold: { type: Boolean, default: false },
  italic: { type: Boolean, default: false },
  align: { type: String, enum: ['left', 'center', 'right', 'justify'], default: 'left' },
  color: { type: String, default: '#1f2937' },
  background: { type: String, default: '' },
  borderColor: { type: String, default: '' },
  borderWidth: { type: Number, default: 0 },
  lineGap: { type: Number, default: 2 },
  padding: { type: Number, default: 0 },

  locked: { type: Boolean, default: false }
}, { _id: false });

const documentTemplateSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true, trim: true },
  type: {
    type: String,
    required: true,
    index: true,
    enum: [
      'PAYSLIP', 'OFFER_LETTER', 'JOINING_LETTER', 'APPOINTMENT_LETTER',
      'CONFIRMATION_LETTER', 'SHOW_CAUSE', 'WARNING_LETTER', 'TERMINATION_LETTER',
      'EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'SALARY_CERTIFICATE',
      'INCREMENT_LETTER', 'NOC', 'CUSTOM'
    ]
  },
  description: { type: String, default: '' },
  active: { type: Boolean, default: false, index: true },

  pageSize: { type: String, enum: ['A4', 'LETTER', 'LEGAL'], default: 'A4' },
  orientation: { type: String, enum: ['portrait', 'landscape'], default: 'portrait' },
  margins: {
    top: { type: Number, default: 40 },
    right: { type: Number, default: 40 },
    bottom: { type: Number, default: 40 },
    left: { type: Number, default: 40 }
  },

  // Repeated on every page.
  watermarkText: { type: String, default: '' },
  watermarkOpacity: { type: Number, default: 0.08 },
  showPageNumbers: { type: Boolean, default: false },

  blocks: [blockSchema],

  version: { type: Number, default: 1 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

documentTemplateSchema.index({ tenantId: 1, type: 1, active: 1 });

documentTemplateSchema.statics.BLOCK_KINDS = BLOCK_KINDS;

module.exports = mongoose.model('DocumentTemplate', documentTemplateSchema);

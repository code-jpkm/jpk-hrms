const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const DocumentAsset = require('../models/DocumentAsset');
const Employee = require('../models/Employee');
const Candidate = require('../models/Candidate');
const axios = require('axios');
const env = require('../config/env');
const { v2: cloudinary } = require('cloudinary');
const { hasAbility } = require('../middleware/auth');
const { getScopedEmployeeIds } = require('../services/scopeService');

const cloudinaryEnabled = Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);
if (cloudinaryEnabled) cloudinary.config({ cloud_name: env.cloudinary.cloudName, api_key: env.cloudinary.apiKey, api_secret: env.cloudinary.apiSecret, secure: true });

const DOCUMENT_LABELS = {
  PHOTO: 'Photograph',
  AADHAR_CARD: 'Aadhaar Card',
  PAN_CARD: 'PAN Card',
  RESUME: 'Resume',
  ACADEMIC_CERTIFICATE: 'Academic Certificate',
  EXPERIENCE_LETTER: 'Experience Letter',
  PREVIOUS_PAYSLIP: 'Previous Company Payslip',
  BANK_STATEMENT: 'Bank Statement',
  OFFER_LETTER: 'Offer Letter',
  JOINING_LETTER: 'Joining Letter',
  OTHER: 'Other Document'
};

async function assertOwnerScope(req, ownerType, ownerId, action = 'READ') {
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user?.role)) return;
  const isSelf = ownerType === 'EMPLOYEE' && req.employee && String(req.employee._id) === String(ownerId);
  if (action === 'READ' && isSelf) return;
  if (!hasAbility(req.user, 'DOCUMENTS', action)) throw new ApiError(403, action === 'READ' ? 'You can only view your own employee documents' : `Missing permission: DOCUMENTS:${action}`);
  if (ownerType === 'EMPLOYEE') {
    const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' });
    if (!allowed.includes(String(ownerId))) throw new ApiError(403, 'Employee document is outside your People Office / Factory scope');
  }
}

async function ensureOwner(req, ownerType, ownerId) {
  if (ownerType === 'EMPLOYEE') {
    const employee = await Employee.findOne({ _id: ownerId, tenantId: req.tenantId });
    if (!employee) throw new ApiError(404, 'Employee not found');
    return employee;
  }
  if (ownerType === 'CANDIDATE') {
    const candidate = await Candidate.findOne({ _id: ownerId, tenantId: req.tenantId });
    if (!candidate) throw new ApiError(404, 'Candidate not found');
    return candidate;
  }
  throw new ApiError(400, 'Invalid owner type');
}

function parseDataUrl(dataUrl = '') {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

exports.listDocuments = asyncHandler(async (req, res) => {
  const { ownerType, ownerId } = req.query;
  if (!ownerType || !ownerId) throw new ApiError(400, 'ownerType and ownerId are required');
  await ensureOwner(req, ownerType, ownerId);
  await assertOwnerScope(req, ownerType, ownerId, 'READ');
  const documents = await DocumentAsset.find({ tenantId: req.tenantId, ownerType, ownerId }).sort('-createdAt').select('-dataUrl');
  res.json({ documents, documentTypes: DOCUMENT_LABELS, storage: { cloudinary: cloudinaryEnabled, provider: cloudinaryEnabled ? 'CLOUDINARY' : 'DATABASE_FALLBACK' } });
});

exports.uploadDocument = asyncHandler(async (req, res) => {
  const { ownerType, ownerId, type, label, fileName, mimeType, sizeBytes, dataUrl, notes } = req.body;
  if (!ownerType || !ownerId || !type || !fileName || !dataUrl) throw new ApiError(400, 'ownerType, ownerId, type, fileName and file are required');
  if (type === 'PHOTO' && mimeType && !String(mimeType).startsWith('image/')) throw new ApiError(400, 'Profile photo must be an image file');
  const owner = await ensureOwner(req, ownerType, ownerId);
  await assertOwnerScope(req, ownerType, ownerId, 'CREATE');
  if (String(dataUrl).length > 12 * 1024 * 1024) throw new ApiError(413, 'Document is too large for inline upload. Keep files under ~8 MB.');
  let cloudAsset = null;
  if (cloudinaryEnabled) cloudAsset = await cloudinary.uploader.upload(dataUrl, { folder: `${env.cloudinary.folder}/${String(ownerType).toLowerCase()}/${ownerId}`, resource_type: 'auto', use_filename: true, unique_filename: true });
  const doc = await DocumentAsset.create({
    tenantId: req.tenantId,
    ownerType,
    ownerId,
    employeeId: ownerType === 'EMPLOYEE' ? owner._id : undefined,
    candidateId: ownerType === 'CANDIDATE' ? owner._id : undefined,
    type,
    label: label || DOCUMENT_LABELS[type] || type,
    fileName,
    mimeType,
    sizeBytes,
    dataUrl: cloudAsset ? undefined : dataUrl,
    url: cloudAsset?.secure_url,
    cloudinaryPublicId: cloudAsset?.public_id,
    notes,
    uploadedBy: req.user._id
  });

  if (ownerType === 'EMPLOYEE') {
    const update = {};
    if (type === 'PHOTO' && cloudAsset?.secure_url) update.profilePhotoUrl = cloudAsset.secure_url;
    if (type === 'AADHAR_CARD') update['onboardingDocuments.aadharCard'] = { label: doc.label, type, fileName, url: `/api/documents/${doc._id}/download` };
    if (type === 'PAN_CARD') update['onboardingDocuments.panCard'] = { label: doc.label, type, fileName, url: `/api/documents/${doc._id}/download` };
    if (type === 'RESUME') update['onboardingDocuments.resume'] = { label: doc.label, type, fileName, url: `/api/documents/${doc._id}/download` };
    if (type === 'PREVIOUS_PAYSLIP') update['onboardingDocuments.previousCompanyPayslip'] = { label: doc.label, type, fileName, url: `/api/documents/${doc._id}/download` };
    if (type === 'BANK_STATEMENT') update['onboardingDocuments.previousCompanyBankStatement'] = { label: doc.label, type, fileName, url: `/api/documents/${doc._id}/download` };
    if (type === 'EXPERIENCE_LETTER') update['onboardingDocuments.experienceLetter'] = { label: doc.label, type, fileName, url: `/api/documents/${doc._id}/download` };
    if (Object.keys(update).length) await Employee.updateOne({ _id: owner._id, tenantId: req.tenantId }, { $set: update });
  }
  const safe = doc.toObject();
  delete safe.dataUrl;
  res.status(201).json({ document: safe });
});

exports.updateDocument = asyncHandler(async (req, res) => {
  const doc = await DocumentAsset.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!doc) throw new ApiError(404, 'Document not found');
  await assertOwnerScope(req, doc.ownerType, doc.ownerId, 'UPDATE');
  const { status, notes, label } = req.body;
  if (status) {
    doc.status = status;
    doc.verifiedBy = req.user._id;
    doc.verifiedAt = new Date();
  }
  if (notes !== undefined) doc.notes = notes;
  if (label !== undefined) doc.label = label;
  await doc.save();
  const safe = doc.toObject();
  delete safe.dataUrl;
  res.json({ document: safe });
});

exports.downloadDocument = asyncHandler(async (req, res) => {
  const doc = await DocumentAsset.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!doc) throw new ApiError(404, 'Document not found');
  await assertOwnerScope(req, doc.ownerType, doc.ownerId, 'READ');
  const parsed = parseDataUrl(doc.dataUrl);
  if (!parsed && doc.url) {
    const response = await axios.get(doc.url, { responseType: 'stream' });
    res.setHeader('Content-Type', doc.mimeType || response.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(doc.fileName).replace(/"/g, '')}"`);
    response.data.pipe(res); return;
  }
  if (!parsed) throw new ApiError(404, 'Document binary data not available');
  res.setHeader('Content-Type', doc.mimeType || parsed.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${String(doc.fileName).replace(/"/g, '')}"`);
  res.end(parsed.buffer);
});

exports.deleteDocument = asyncHandler(async (req, res) => {
  const doc = await DocumentAsset.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!doc) throw new ApiError(404, 'Document not found');
  await assertOwnerScope(req, doc.ownerType, doc.ownerId, 'DELETE');
  await DocumentAsset.deleteOne({ _id: doc._id, tenantId: req.tenantId });
  if (doc.ownerType === 'EMPLOYEE' && doc.type === 'PHOTO') {
    await Employee.updateOne({ _id: doc.ownerId, tenantId: req.tenantId, profilePhotoUrl: doc.url }, { $unset: { profilePhotoUrl: 1 } });
  }
  if (cloudinaryEnabled && doc.cloudinaryPublicId) await cloudinary.uploader.destroy(doc.cloudinaryPublicId, { resource_type: 'auto' });
  res.json({ deleted: true, message: 'Document deleted successfully' });
});

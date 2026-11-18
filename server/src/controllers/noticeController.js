const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Notice = require('../models/Notice');
const env = require('../config/env');
const { hasAbility } = require('../middleware/auth');
const { getNoticePublishingScope, assertNoticeAudience } = require('../services/noticeAudienceService');
const { v2: cloudinary } = require('cloudinary');
const Employee = require('../models/Employee');
const { notifyLater } = require('../services/messaging/dispatcher');
const enabled = Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);
if (enabled) cloudinary.config({ cloud_name: env.cloudinary.cloudName, api_key: env.cloudinary.apiKey, api_secret: env.cloudinary.apiSecret, secure: true });

exports.list = asyncHandler(async (req, res) => {
  const employee = req.employee;
  const accessAll = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role);
  const filters = accessAll ? {} : { $or: [
    { employeeIds: employee?._id },
    { employeeIds: { $size: 0 }, audienceLocations: employee?.workLocation === 'BOTH' ? { $in: ['OFFICE', 'FACTORY'] } : employee?.workLocation },
    { employeeIds: { $size: 0 }, audienceLocations: { $size: 0 } }
  ] };
  const notices = await Notice.find({ tenantId: req.tenantId, ...filters, $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gte: new Date() } }] }] })
    .populate('publishedBy', 'name').select('-dataUrl').sort('-pinned -createdAt');
  const canManage = hasAbility(req.user, 'NOTICES', 'MANAGE');
  const publishingScope = canManage ? await getNoticePublishingScope(req) : null;
  res.json({ notices, storage: { cloudinary: enabled, provider: enabled ? 'CLOUDINARY' : 'DATABASE_FALLBACK' }, publishingScope });
});

exports.create = asyncHandler(async (req, res) => {
  const { title, body, audienceLocations = [], employeeIds = [], fileName, mimeType, dataUrl, pinned, expiresAt } = req.body;
  if (!title) throw new ApiError(400, 'Notice title is required');
  const audience = await assertNoticeAudience(req, { audienceLocations, employeeIds });
  let asset = null;
  if (dataUrl && enabled) asset = await cloudinary.uploader.upload(dataUrl, { folder: `${env.cloudinary.folder}/notices`, resource_type: 'auto' });
  const notice = await Notice.create({
    tenantId: req.tenantId,
    title,
    body,
    audienceLocations: audience.audienceLocations,
    employeeIds: audience.employeeIds,
    fileName,
    mimeType,
    dataUrl: asset ? undefined : dataUrl,
    url: asset?.secure_url,
    cloudinaryPublicId: asset?.public_id,
    pinned,
    expiresAt: expiresAt || undefined,
    publishedBy: req.user._id
  });

  // Tell the audience. The composer can switch channels per notice; otherwise
  // the "Notice published" rule in Integrations decides.
  const delivery = req.body.delivery || {};
  if (delivery.notify !== false) {
    const q = { tenantId: req.tenantId, status: { $ne: 'OFFBOARDED' } };
    if (notice.employeeIds?.length) q._id = { $in: notice.employeeIds };
    else if (notice.audienceLocations?.length) q.workLocation = { $in: [...notice.audienceLocations, 'BOTH'] };
    const people = await Employee.find(q).select('_id firstName lastName userId email phone').lean();
    const channels = {};
    if (delivery.email !== undefined) channels.email = Boolean(delivery.email);
    if (delivery.whatsapp !== undefined) channels.whatsapp = Boolean(delivery.whatsapp);
    notifyLater({
      tenantId: req.tenantId,
      event: 'NOTICE_PUBLISHED',
      recipients: people.map((p) => ({ employee: p, employeeId: p._id })),
      path: '/notices',
      entityId: notice._id,
      actorUserId: req.user._id,
      channels: Object.keys(channels).length ? channels : null,
      data: { title: notice.title, body: notice.body || '', attachmentName: notice.fileName },
      inApp: { type: 'NOTICE', title: `Notice: ${notice.title}`, body: String(notice.body || '').slice(0, 200), entityType: 'NOTICE', priority: notice.pinned ? 'HIGH' : 'NORMAL' }
    });
  }
  res.status(201).json({ notice });
});

exports.remove = asyncHandler(async (req, res) => {
  const query = { _id: req.params.id, tenantId: req.tenantId };
  if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)) query.publishedBy = req.user._id;
  const notice = await Notice.findOneAndDelete(query);
  if (!notice) throw new ApiError(404, 'Notice not found or you are not allowed to remove it');
  if (enabled && notice.cloudinaryPublicId) await cloudinary.uploader.destroy(notice.cloudinaryPublicId, { resource_type: 'auto' });
  res.json({ deleted: true });
});

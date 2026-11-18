const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const BiometricDevice = require('../models/BiometricDevice');
const RawPunchLog = require('../models/RawPunchLog');
const { syncDevice, syncAllDevices, importBiometricLogs, testDeviceConnection } = require('../services/biometricService');
const adms = require('../services/admsService');
const { recordAudit } = require('../services/auditService');

const auditMachine = (req, action, targetId, after, reason) => recordAudit({
  tenantId: req.tenantId, module: 'ATTENDANCE', action, targetId: String(targetId || ''), after, reason, changedBy: req.user?._id
});

exports.listDevices = asyncHandler(async (req, res) => {
  const devices = await BiometricDevice.find({ tenantId: req.tenantId, mode: { $ne: 'ADMS' } }).sort('name');
  res.json({ devices });
});

// ---------------------------------------------------------------------------
// Machines that send punches by themselves (ADMS / Cloud Server mode)

exports.machines = asyncHandler(async (req, res) => {
  res.json(await adms.overview({ tenantId: req.tenantId, req }));
});

exports.addMachine = asyncHandler(async (req, res) => {
  const { serialNumber, name, locationName, importFrom } = req.body || {};
  const result = await adms.addMachine({ tenantId: req.tenantId, userId: req.user?._id, serialNumber, name, locationName, importFrom });
  await auditMachine(req, 'MACHINE_ADDED', result.device._id, { name: result.device.name, serialNumber: result.device.serialNumber, importFrom: result.device.importFrom },
    `Added attendance machine ${result.device.name} (${result.device.serialNumber}); punches count from ${result.device.importFrom}`);
  res.status(result.added ? 201 : 200).json({ ok: true, ...result });
});

exports.approveMachine = asyncHandler(async (req, res) => {
  const { name, locationName, importFrom } = req.body || {};
  const result = await adms.approveMachine({ tenantId: req.tenantId, id: req.params.id, userId: req.user?._id, name, locationName, importFrom });
  await auditMachine(req, 'MACHINE_APPROVED', result.device._id, { name: result.device.name, serialNumber: result.device.serialNumber, importFrom: result.device.importFrom },
    `Approved attendance machine ${result.device.name} (${result.device.serialNumber}); punches count from ${result.device.importFrom}`);
  res.json({ ok: true, ...result });
});

exports.updateMachine = asyncHandler(async (req, res) => {
  const { name, locationName, importFrom, timezoneOffsetMinutes } = req.body || {};
  const result = await adms.updateMachine({ tenantId: req.tenantId, id: req.params.id, name, locationName, importFrom, timezoneOffsetMinutes });
  await auditMachine(req, 'MACHINE_UPDATED', result.device._id, { name: result.device.name, locationName: result.device.locationName, importFrom: result.device.importFrom });
  res.json({ ok: true, ...result });
});

exports.stopMachine = asyncHandler(async (req, res) => {
  const result = await adms.stopMachine({ tenantId: req.tenantId, id: req.params.id });
  await auditMachine(req, 'MACHINE_STOPPED', result.device._id, { serialNumber: result.device.serialNumber }, `Stopped using attendance machine ${result.device.name}`);
  res.json({ ok: true, ...result });
});

exports.removeMachine = asyncHandler(async (req, res) => {
  const result = await adms.removeMachine({ tenantId: req.tenantId, id: req.params.id });
  await auditMachine(req, 'MACHINE_REMOVED', req.params.id, null, 'Removed an attendance machine that was never approved');
  res.json({ ok: true, ...result });
});

exports.linkMachineId = asyncHandler(async (req, res) => {
  const { pin, employeeId } = req.body || {};
  const result = await adms.linkMachineId({ tenantId: req.tenantId, pin, employeeId: employeeId || null });
  await auditMachine(req, 'MACHINE_ID_LINKED', result.employeeId || '', { machineId: result.pin, employeeId: result.employeeId, punchesMoved: result.moved },
    result.employeeId ? `Machine ID ${result.pin} linked` : `Machine ID ${result.pin} unlinked`);
  res.json({ ok: true, ...result });
});

exports.processMachinePunches = asyncHandler(async (req, res) => {
  res.json({ ok: true, ...(await adms.processNow({ tenantId: req.tenantId })) });
});

exports.createDevice = asyncHandler(async (req, res) => {
  if ((req.body.mode || 'PUSH') === 'PUSH' && !req.body.apiToken) {
    throw new ApiError(400, 'PUSH mode requires API Token. This token must match the DEVICE_TOKEN in the factory/office bridge .env file.');
  }
  const device = await BiometricDevice.create({ ...req.body, tenantId: req.tenantId });
  res.status(201).json({ device });
});

exports.updateDevice = asyncHandler(async (req, res) => {
  if (req.body.mode === 'PUSH' && !req.body.apiToken) {
    throw new ApiError(400, 'PUSH mode requires API Token. This token must match the DEVICE_TOKEN in the factory/office bridge .env file.');
  }
  const device = await BiometricDevice.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId }, req.body, { new: true });
  if (!device) throw new ApiError(404, 'Biometric device not found');
  res.json({ device });
});

exports.syncOne = asyncHandler(async (req, res) => {
  const device = await BiometricDevice.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!device) throw new ApiError(404, 'Biometric device not found');
  const result = await syncDevice(device);
  res.json(result);
});

exports.syncAll = asyncHandler(async (req, res) => {
  const results = await syncAllDevices({ tenantId: req.tenantId, force: true });
  res.json({ results });
});

exports.rawPunches = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const q = { tenantId: req.tenantId };
  if (req.query.deviceId) q.deviceId = req.query.deviceId;
  if (req.query.employeeId) q.employeeId = req.query.employeeId;
  const punches = await RawPunchLog.find(q).populate('employeeId', 'employeeCode firstName lastName').sort('-timestamp').limit(limit);
  res.json({ punches });
});

exports.importManualLogs = asyncHandler(async (req, res) => {
  const device = req.body.deviceMongoId ? await BiometricDevice.findOne({ _id: req.body.deviceMongoId, tenantId: req.tenantId }) : null;
  const logs = req.body.logs || req.body.data || [];
  if (!Array.isArray(logs) || !logs.length) throw new ApiError(400, 'logs array is required');
  const result = await importBiometricLogs({ tenantId: req.tenantId, logs, device });
  res.status(201).json(result);
});


/**
 * The device token must be a plain string. v26: `?token[$ne]=x` used to reach
 * the query as `{ $ne: 'x' }`, which matched ANY enabled device with that id,
 * so anyone could push punches. The token is now compared in constant time
 * against each candidate device instead of being placed in the query.
 */
function firstString(...values) {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

function extractDeviceToken(req) {
  const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  return firstString(req.headers['x-device-token'], req.headers['x-bridge-token'], bearer, req.query.token);
}

function tokensMatch(expected, supplied) {
  const a = Buffer.from(String(expected || ''), 'utf8');
  const b = Buffer.from(String(supplied || ''), 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.publicPush = asyncHandler(async (req, res) => {
  const token = extractDeviceToken(req);
  if (!token) throw new ApiError(401, 'Device token is required');
  const deviceId = String(req.params.deviceId || '').trim();
  const candidates = deviceId ? await BiometricDevice.find({ deviceId, enabled: true }) : [];
  const device = candidates.find((candidate) => tokensMatch(candidate.apiToken, token));
  if (!device) throw new ApiError(401, 'Invalid device/token or disabled biometric device');
  const logs = req.body.logs || req.body.data || req.body.attendance || [];
  if (device.mode !== 'PUSH') {
    // Keep backward compatibility, but record that this device is receiving pushed data.
    device.mode = 'PUSH';
  }
  if (!Array.isArray(logs) || !logs.length) throw new ApiError(400, 'logs array is required');
  const result = await importBiometricLogs({ tenantId: device.tenantId, logs, device });
  device.lastSyncAt = new Date();
  device.lastSuccessAt = new Date();
  device.lastError = '';
  device.lastImportedCount = result.imported;
  device.status = 'OK';
  await device.save();
  res.status(201).json({ ok: true, deviceId: device.deviceId, ...result });
});

exports.testDevice = asyncHandler(async (req, res) => {
  const device = await BiometricDevice.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!device) throw new ApiError(404, 'Biometric device not found');
  const result = await testDeviceConnection(device);
  res.json(result);
});

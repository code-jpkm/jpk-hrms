const axios = require('axios');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const BiometricDevice = require('../models/BiometricDevice');
const RawPunchLog = require('../models/RawPunchLog');
const { resolveAttendanceDateForPunch, statusFromWorkedMinutes } = require('../utils/shift');
const { evaluateAttendanceRecord } = require('./attendanceRulesService');

function normalizeLog(raw, device) {
  const employeeCode = raw.employeeCode || raw.empCode || raw.employee_code || raw.pin || raw.userCode || raw.user_code || raw.enrollNumber || raw.enroll_number || raw.userId || raw.user_id || raw.uid || raw.id || raw.employee_id;
  const deviceUserId = raw.deviceUserId || raw.device_user_id || raw.userId || raw.user_id || raw.uid || raw.id || raw.pin || raw.enrollNumber || raw.enroll_number || employeeCode;
  const timestamp = raw.timestamp || raw.punchTime || raw.punch_time || raw.recordTime || raw.record_time || raw.attTime || raw.att_time || raw.time || raw.datetime || raw.attendanceTime || raw.attendance_time || raw.VerifyTime;
  return {
    employeeCode: employeeCode ? String(employeeCode).trim() : undefined,
    deviceUserId: deviceUserId ? String(deviceUserId).trim() : undefined,
    timestamp: timestamp ? new Date(timestamp) : null,
    punchType: String(raw.punchType || raw.type || raw.inOut || 'UNKNOWN').toUpperCase().includes('OUT') ? 'OUT' : (String(raw.punchType || raw.type || raw.inOut || 'UNKNOWN').toUpperCase().includes('IN') ? 'IN' : 'UNKNOWN'),
    deviceId: raw.deviceId || device?.deviceId,
    locationName: raw.locationName || device?.locationName,
    raw
  };
}

function normalizeLogs(payload, device) {
  const source = Array.isArray(payload) ? payload : (payload?.logs || payload?.data || payload?.attendance || []);
  return source.map((row) => normalizeLog(row, device)).filter((row) => row.timestamp && !Number.isNaN(row.timestamp.getTime()));
}

// Two punches of the same person this close together are one punch (pressed twice).
const DUPLICATE_MINUTES = () => Math.max(0, Number(process.env.BIOMETRIC_DUPLICATE_MINUTES ?? process.env.ADMS_DUPLICATE_MINUTES ?? 2) || 0);

const REASONS = {
  NOT_LINKED: 'Machine ID not linked to an employee',
  DUPLICATE: 'Repeat punch (ignored)',
  KEPT_CORRECTION: 'Kept the approved correction for this day'
};

async function findEmployeeForPunch(tenantId, log) {
  const ors = [];
  if (log.employeeCode) ors.push({ employeeCode: log.employeeCode }, { 'biometric.code': log.employeeCode });
  if (log.deviceUserId) ors.push({ 'biometric.deviceUserId': log.deviceUserId }, { employeeCode: log.deviceUserId }, { 'biometric.code': log.deviceUserId });
  if (!ors.length) return null;
  // Prefer people still with the company when an ID was reused.
  const current = await Employee.findOne({ tenantId, status: { $ne: 'OFFBOARDED' }, $or: ors });
  if (current) return current;
  const any = await Employee.findOne({ tenantId, $or: ors });
  if (any) return any;
  // "0101" on the machine and "101" in the HRMS are the same machine ID.
  const id = String(log.deviceUserId || log.employeeCode || '').trim();
  if (/^\d+$/.test(id)) {
    const digits = id.replace(/^0+/, '');
    if (digits) {
      const pattern = new RegExp(`^0*${digits}$`);
      return Employee.findOne({ tenantId, $or: [{ 'biometric.deviceUserId': pattern }, { 'biometric.code': pattern }] }).sort({ status: 1 });
    }
  }
  return null;
}

/**
 * Add one punch to the person's attendance for the day it belongs to (shift and
 * night-shift aware) and mark the stored raw punch as used. Shared by the
 * bridges, manual imports and machines that push by themselves (ADMS).
 */
async function applyToAttendance({ tenantId, rawPunchId, log, employee }) {
  const markRaw = (set, unset) => (rawPunchId
    ? RawPunchLog.updateOne({ _id: rawPunchId }, { $set: { pending: false, ...set }, ...(unset ? { $unset: unset } : {}) })
    : null);
  const { attendanceDate, shift } = await resolveAttendanceDateForPunch({ tenantId, employeeId: employee._id, timestamp: log.timestamp });
  const existing = await Attendance.findOne({ tenantId, employeeId: employee._id, date: attendanceDate });

  // An approved correction (or an HR override) is final: later machine punches never change it.
  if (existing && existing.source === 'OVERRIDE') {
    await markRaw({ employeeId: employee._id, imported: true, importedAttendanceId: existing._id, skippedReason: REASONS.KEPT_CORRECTION });
    return { status: 'KEPT_CORRECTION', employeeCode: employee.employeeCode, attendanceId: existing._id, attendanceDate };
  }

  // Never copy the first punch into both check-in and check-out. That created
  // zero-minute attendance records that could later appear as PRESENT.
  let checkIn = existing?.checkIn ? new Date(existing.checkIn) : undefined;
  let checkOut = existing?.checkOut ? new Date(existing.checkOut) : undefined;
  const punchTime = new Date(log.timestamp);
  const repeatWindow = DUPLICATE_MINUTES() * 60000;
  let repeat = false;

  // The very punch already used for this day (sent again, or worked out again): nothing changes.
  const sameTime = (value) => value && value.getTime() === punchTime.getTime();
  if (existing && (sameTime(checkIn) || sameTime(checkOut))) {
    await markRaw({ employeeId: employee._id, imported: true, importedAttendanceId: existing._id }, { skippedReason: 1 });
    return { status: 'IMPORTED', employeeCode: employee.employeeCode, attendanceId: existing._id, attendanceDate, unchanged: true };
  }

  if (log.punchType === 'OUT') {
    if (checkIn && punchTime > checkIn) checkOut = !checkOut || punchTime > checkOut ? punchTime : checkOut;
    else if (!checkIn) checkOut = punchTime; // keep an unmatched OUT visible for regularization/reprocessing
  } else if (log.punchType === 'IN') {
    checkIn = !checkIn || punchTime < checkIn ? punchTime : checkIn;
  } else if (!checkIn) {
    // UNKNOWN is common on ESSL/ZKTeco exports. The first distinct punch is IN.
    checkIn = punchTime;
  } else if (punchTime < checkIn) {
    // An earlier punch that arrived late (the machine was offline): it becomes the
    // check-in, and the old check-in becomes the check-out when there is none yet.
    if (!checkOut && checkIn - punchTime >= repeatWindow) checkOut = checkIn;
    checkIn = punchTime;
  } else if (punchTime - checkIn < repeatWindow || (checkOut && punchTime <= checkOut)) {
    // Pressed twice, or a punch already covered by the day's in-out window.
    repeat = punchTime - checkIn < repeatWindow;
  } else {
    // A later distinct UNKNOWN punch becomes OUT.
    checkOut = punchTime;
  }

  if (repeat) {
    await markRaw({ employeeId: employee._id, imported: true, importedAttendanceId: existing?._id, skippedReason: REASONS.DUPLICATE });
    return { status: 'DUPLICATE', employeeCode: employee.employeeCode, attendanceId: existing?._id, attendanceDate };
  }

  // Same timestamp must not be stored as both ends of the duty window.
  if (checkIn && checkOut && checkOut <= checkIn) {
    if (log.punchType === 'OUT' && !existing?.checkIn) checkIn = undefined;
    else checkOut = undefined;
  }

  const status = statusFromWorkedMinutes(shift, checkIn, checkOut, 'PRESENT');
  const patch = {
    tenantId,
    employeeId: employee._id,
    date: attendanceDate,
    source: 'BIOMETRIC',
    status,
    biometricDeviceId: log.deviceId,
    location: { siteName: log.locationName },
    meta: {
      ...(existing?.meta || {}),
      shiftId: shift?._id,
      shiftName: shift?.name,
      lastBiometricPunchType: log.punchType,
      lastBiometricPunchAt: punchTime
    }
  };
  if (checkIn) patch.checkIn = checkIn;
  if (checkOut) patch.checkOut = checkOut;

  const update = { $set: patch };
  if (!checkIn) update.$unset = { checkIn: 1 };
  if (!checkOut) update.$unset = { ...(update.$unset || {}), checkOut: 1 };

  const attendance = await Attendance.findOneAndUpdate(
    { tenantId, employeeId: employee._id, date: attendanceDate },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await evaluateAttendanceRecord(attendance);
  await markRaw({ employeeId: employee._id, imported: true, importedAttendanceId: attendance._id }, { skippedReason: 1 });
  return { status: 'IMPORTED', employeeCode: employee.employeeCode, attendanceId: attendance._id, attendanceDate };
}

async function savePunchAndApply({ tenantId, log, device }) {
  const employee = await findEmployeeForPunch(tenantId, log);
  let rawPunch;
  try {
    rawPunch = await RawPunchLog.findOneAndUpdate(
      { tenantId, deviceId: log.deviceId, deviceUserId: log.deviceUserId || log.employeeCode || 'UNKNOWN', timestamp: log.timestamp },
      {
        $setOnInsert: {
          tenantId,
          biometricDeviceMongoId: device?._id,
          deviceId: log.deviceId,
          locationName: log.locationName,
          employeeCode: log.employeeCode,
          deviceUserId: log.deviceUserId || log.employeeCode || 'UNKNOWN',
          timestamp: log.timestamp,
          punchType: log.punchType,
          receivedAt: new Date(),
          raw: log.raw
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    rawPunch = await RawPunchLog.findOne({ tenantId, deviceId: log.deviceId, deviceUserId: log.deviceUserId || log.employeeCode || 'UNKNOWN', timestamp: log.timestamp });
  }

  if (!employee) {
    rawPunch.skippedReason = 'Employee not found for employeeCode/deviceUserId';
    rawPunch.imported = false;
    await rawPunch.save();
    return { status: 'SKIPPED', reason: rawPunch.skippedReason, log };
  }

  return applyToAttendance({ tenantId, rawPunchId: rawPunch._id, log, employee });
}

async function importBiometricLogs({ tenantId, logs, device }) {
  const normalized = normalizeLogs(logs, device);
  const results = [];
  for (const log of normalized) {
    results.push(await savePunchAndApply({ tenantId, log, device }));
  }
  return { imported: results.filter((r) => r.status === 'IMPORTED').length, total: normalized.length, results };
}

function buildZkDirectLogs(logs, device) {
  const source = Array.isArray(logs) ? logs : (logs?.data || logs?.attendances || logs?.records || []);
  return source.map((row) => ({ ...row, deviceId: device.deviceId, locationName: device.locationName }));
}

async function fetchDeviceLogs(device) {
  if (device.mode === 'PUSH') return [];
  if (device.mode === 'MANUAL_JSON') return [];
  if (device.mode === 'MOCK') {
    return [{ employeeCode: 'EMP003', deviceUserId: 'EMP003', timestamp: new Date().toISOString(), deviceId: device.deviceId, locationName: device.locationName }];
  }
  if (device.mode === 'HTTP_PULL') {
    if (!device.apiUrl) throw new Error('HTTP_PULL requires apiUrl returning logs/data array');
    const response = await axios.get(device.apiUrl, {
      params: { since: device.lastSyncAt ? device.lastSyncAt.toISOString() : undefined, deviceId: device.deviceId },
      headers: device.apiToken ? { Authorization: `Bearer ${device.apiToken}`, 'x-bridge-token': device.apiToken } : undefined,
      timeout: 30000
    });
    return response.data;
  }
  if (device.mode === 'ZKTECO_DIRECT') {
    let ZKLib;
    try {
      ZKLib = require('node-zklib');
    } catch (error) {
      throw new Error('ZKTECO_DIRECT needs optional package node-zklib or an ESSL/ZKTeco HTTP bridge. Use HTTP_PULL mode if your machine is behind a local network.');
    }
    const zk = new ZKLib(device.ip, device.port || 4370, 10000, 4000);
    await zk.createSocket();
    const logs = await zk.getAttendances();
    await zk.disconnect();
    return buildZkDirectLogs(logs, device);
  }
  return [];
}


async function testDeviceConnection(device) {
  if (device.mode === 'ADMS') {
    const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt) : null;
    const online = Boolean(lastSeen && Date.now() - lastSeen.getTime() < 3 * 60 * 1000);
    return { ok: online, message: online ? 'The machine is connected and checking in.' : `The machine has not checked in${lastSeen ? ` since ${lastSeen.toISOString()}` : ' yet'}.` };
  }
  if (device.mode === 'PUSH') return { ok: true, message: 'PUSH mode is configured. The local factory/office bridge will send punches to /api/biometric/public-push/' + device.deviceId, pushEndpoint: '/api/biometric/public-push/' + device.deviceId };
  if (device.mode === 'MANUAL_JSON') return { ok: true, message: 'Manual JSON mode does not require live device connection' };
  if (device.mode === 'MOCK') return { ok: true, message: 'Mock mode is reachable', sampleCount: 1 };
  if (device.mode === 'HTTP_PULL') {
    if (!device.apiUrl) throw new Error('HTTP_PULL requires apiUrl');
    const response = await axios.get(device.apiUrl, {
      params: { deviceId: device.deviceId },
      headers: device.apiToken ? { Authorization: `Bearer ${device.apiToken}`, 'x-bridge-token': device.apiToken } : undefined,
      timeout: 30000
    });
    const logs = normalizeLogs(response.data, device);
    return { ok: true, message: 'HTTP pull/bridge reachable', sampleCount: logs.length, sample: logs.slice(0, 5) };
  }
  if (device.mode === 'ZKTECO_DIRECT') {
    const payload = await fetchDeviceLogs({ ...device.toObject?.() || device, lastSyncAt: undefined });
    const logs = normalizeLogs(payload, device);
    return { ok: true, message: 'Direct ZKTeco/ESSL connection reachable', sampleCount: logs.length, sample: logs.slice(0, 5) };
  }
  return { ok: false, message: `Unsupported mode ${device.mode}` };
}

async function syncDevice(device) {
  if (device.mode === 'ADMS') {
    return { device, result: { skipped: true, mode: 'ADMS', reason: 'This machine sends punches to the HRMS by itself.' } };
  }
  if (device.mode === 'PUSH') {
    device.status = device.status === 'ERROR' ? 'READY' : device.status || 'READY';
    await device.save();
    return { device, result: { skipped: true, mode: 'PUSH', reason: 'PUSH mode is handled by the local bridge. Use the bridge Sync Now button or wait for its 5-minute scheduler.' } };
  }
  device.status = 'SYNCING';
  await device.save();
  try {
    const payload = await fetchDeviceLogs(device);
    const result = await importBiometricLogs({ tenantId: device.tenantId, logs: payload, device });
    device.lastSyncAt = new Date();
    device.lastSuccessAt = new Date();
    device.lastError = '';
    device.lastImportedCount = result.imported;
    device.status = 'OK';
    await device.save();
    return { device, result };
  } catch (error) {
    device.lastSyncAt = new Date();
    device.lastError = error.message;
    device.status = 'ERROR';
    await device.save();
    return { device, result: { imported: 0, total: 0, error: error.message } };
  }
}

async function syncAllDevices({ tenantId, force = false } = {}) {
  const q = { enabled: true, mode: { $ne: 'ADMS' } };
  if (tenantId) q.tenantId = tenantId;
  const devices = await BiometricDevice.find(q);
  const now = Date.now();
  const results = [];
  for (const device of devices) {
    const everyMs = Math.max(Number(device.syncEveryMinutes || 5), 1) * 60 * 1000;
    const due = force || !device.lastSyncAt || (now - new Date(device.lastSyncAt).getTime()) >= everyMs;
    if (!due) {
      results.push({ device, result: { skipped: true, reason: `Next sync not due before ${device.syncEveryMinutes || 5} minute interval` } });
      continue;
    }
    results.push(await syncDevice(device));
  }
  return results;
}

module.exports = { normalizeLogs, importBiometricLogs, fetchDeviceLogs, testDeviceConnection, syncDevice, syncAllDevices, findEmployeeForPunch, applyToAttendance, DUPLICATE_MINUTES, REASONS };

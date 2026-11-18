// Attendance machines that send punches by themselves: "ADMS" / "Cloud Server"
// mode on eSSL and ZKTeco machines (the iclock push protocol).
//
// The machine calls the HRMS on its own — no software on any computer:
//   GET  /iclock/cdata?SN=…&options=all     first call after start-up → we answer what to send
//   POST /iclock/cdata?SN=…&table=ATTLOG    punches, one per line: PIN \t YYYY-MM-DD HH:MM:SS \t status \t verify …
//   POST /iclock/cdata?SN=…&table=OPERLOG   people on the machine ("USER PIN=7\tName=Rahul …")
//   GET  /iclock/getrequest?SN=…            "any commands?" every half minute → we answer OK
//
// Punches are saved first and answered at once (a first upload can hold years of
// punches). They are then added to attendance in the background, with exactly
// the same rules as every other punch: shift, night shift, late marks, LOP.
// A new machine waits for HR to approve it; until then its punches are kept but not used.

const BiometricDevice = require('../models/BiometricDevice');
const RawPunchLog = require('../models/RawPunchLog');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Tenant = require('../models/Tenant');
const ApiError = require('../utils/apiError');
const { findEmployeeForPunch, applyToAttendance, REASONS: PUNCH_REASONS } = require('./biometricService');
const { rebuildAttendanceFromRawPunches } = require('./attendanceReprocessService');

const REASONS = {
  ...PUNCH_REASONS,
  WAITING: 'Machine waiting for approval',
  BEFORE_START: 'Before the start date of this machine',
  FUTURE: 'Punch time is in the future (check the machine clock)'
};

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const DEFAULT_OFFSET = () => num(process.env.ADMS_TZ_OFFSET_MINUTES, 330);
const POLL_SECONDS = () => Math.max(10, num(process.env.ADMS_POLL_SECONDS, 30));
const ONLINE_MS = () => Math.max(3 * 60 * 1000, POLL_SECONDS() * 3000);
const MAX_WAITING_MACHINES = 20;

const cleanSerial = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
const cleanPin = (value) => String(value || '').trim().replace(/[^\w-]/g, '').slice(0, 24);
const preApproved = () => String(process.env.ADMS_SERIALS || '').split(/[,\s]+/).map(cleanSerial).filter(Boolean);
const isDayKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

/** India calendar day ("YYYY-MM-DD") of a moment, whatever the server's own time zone. */
function dayKeyAt(date, offsetMinutes = DEFAULT_OFFSET()) {
  return new Date(new Date(date).getTime() + offsetMinutes * 60000).toISOString().slice(0, 10);
}

/** Start of a calendar day in the machine's time zone, as a real moment. */
function dayStart(key, offsetMinutes = DEFAULT_OFFSET()) {
  return new Date(Date.parse(`${key}T00:00:00Z`) - offsetMinutes * 60000);
}

/** "2026-11-16 09:58:03" as shown on the machine (its local time) → Date. */
function parseMachineTime(text, offsetMinutes = DEFAULT_OFFSET()) {
  const m = String(text || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] || 0].map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Tab separated "key=value" pairs ("PIN=7\tName=Rahul"). */
function keyValues(line) {
  const out = {};
  for (const part of String(line).split('\t')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const lines = (body) => String(body || '').split(/\r?\n/).map((line) => line.replace(/\s+$/, '')).filter(Boolean);

// ---------------------------------------------------------------- machines

// The machine checks in every half minute: keep "last seen" writes to one a minute.
const seen = new Map();
function forget(serial) { seen.delete(cleanSerial(serial)); }

async function tenantForNewMachine() {
  if (process.env.ADMS_TENANT_ID) return process.env.ADMS_TENANT_ID;
  const tenants = await Tenant.find({ status: { $ne: 'DISABLED' } }).select('_id').limit(2).lean();
  return tenants.length === 1 ? tenants[0]._id : null;
}

/**
 * The machine named in ?SN=…, registered (waiting for approval) on first contact.
 * null = not accepted (no company to put it in, or too many strangers waiting).
 */
async function machineFor(serialValue, { ip = '', pushVersion = '', info = null } = {}) {
  const serial = cleanSerial(serialValue);
  if (!serial) return null;
  const now = Date.now();
  const cached = seen.get(serial);
  if (cached && now - cached.at < 60000 && !info) return cached.device;

  let device = await BiometricDevice.findOne({ mode: 'ADMS', serialNumber: serial }).sort({ approved: -1 }).lean();
  if (!device) {
    const tenantId = await tenantForNewMachine();
    if (!tenantId) {
      console.warn(`[ADMS] Machine ${serial} is not registered. Add it in Attendance machines or set ADMS_TENANT_ID.`);
      return null;
    }
    const auto = preApproved().includes(serial);
    const waiting = await BiometricDevice.countDocuments({ tenantId, mode: 'ADMS', approved: { $ne: true } });
    if (waiting >= MAX_WAITING_MACHINES && !auto) return null;
    try {
      device = (await BiometricDevice.create({
        tenantId,
        name: 'Attendance machine',
        vendor: 'ESSL',
        deviceId: serial,
        serialNumber: serial,
        locationName: 'Office',
        mode: 'ADMS',
        enabled: true,
        status: 'READY',
        approved: auto,
        approvedAt: auto ? new Date() : undefined,
        importFrom: auto ? dayKeyAt(new Date()) : undefined,
        timezoneOffsetMinutes: DEFAULT_OFFSET(),
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        lastIp: ip,
        pushVersion: pushVersion || undefined
      })).toObject();
      console.log(`[ADMS] New attendance machine ${serial} connected${auto ? ' (approved by ADMS_SERIALS)' : ' — approve it in Attendance machines'}.`);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      device = await BiometricDevice.findOne({ mode: 'ADMS', serialNumber: serial }).lean();
      if (!device) {
        console.warn(`[ADMS] Machine ${serial}: another device already uses "${serial}" as its Device ID.`);
        return null;
      }
    }
  } else {
    const set = { lastSeenAt: new Date() };
    if (ip) set.lastIp = ip;
    if (pushVersion) set.pushVersion = pushVersion;
    if (info) {
      set.machineInfo = info;
      if (info.firmware) set.firmware = info.firmware;
    }
    if (!device.approved && preApproved().includes(serial)) {
      set.approved = true;
      set.approvedAt = new Date();
      if (!device.importFrom) set.importFrom = dayKeyAt(new Date());
    }
    await BiometricDevice.updateOne({ _id: device._id }, { $set: set });
    Object.assign(device, set);
  }
  seen.set(serial, { at: now, device });
  return device;
}

/** Answer to the machine's first call: what to send us and how often to call. */
function handshake(device) {
  const out = [
    `GET OPTION FROM: ${device.serialNumber}`,
    `ATTLOGStamp=${device.attlogStamp || 'None'}`,
    `OPERLOGStamp=${device.operlogStamp || 'None'}`,
    'ATTPHOTOStamp=None',
    'ErrorDelay=60',
    `Delay=${POLL_SECONDS()}`,
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    // Punches and the list of people only — never fingerprint or face templates.
    'TransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser',
    'Realtime=1',
    'Encrypt=None'
  ];
  // The machine sets its clock from the server and adds this time zone. Without
  // it some machines fall back to another zone and every punch time is off.
  // ADMS_TIMEZONE=off stops sending it.
  const tz = String(process.env.ADMS_TIMEZONE ?? String(device.timezoneOffsetMinutes ?? DEFAULT_OFFSET())).trim();
  if (tz && tz.toLowerCase() !== 'off') out.splice(9, 0, `TimeZone=${tz}`);
  return out.join('\n');
}

/** INFO=firmware,users,fingerprints,punches,ip,… sent with each check-in. */
function parseInfo(value) {
  if (!value) return null;
  const f = String(value).split(',');
  return {
    firmware: String(f[0] || '').slice(0, 80),
    users: num(f[1], undefined),
    fingerprints: num(f[2], undefined),
    punches: num(f[3], undefined),
    ip: String(f[4] || '').slice(0, 40)
  };
}

// ---------------------------------------------------------------- receiving

/** Store and use what the machine sent. Returns how many lines were taken. */
async function receive(device, table, body, query = {}) {
  const t = String(table || '').toUpperCase();
  if (t === 'ATTLOG') return receivePunches(device, body, query);
  if (t === 'OPERLOG' || t === 'USERINFO' || t === 'USER') return receivePeople(device, body, query);
  return lines(body).length;
}

async function receivePunches(device, body, query) {
  const all = lines(body);
  const offset = num(device.timezoneOffsetMinutes, DEFAULT_OFFSET());
  const rows = [];
  const keys = new Set();
  let latest = null;
  for (const line of all) {
    const f = line.split('\t');
    const pin = cleanPin(f[0]);
    const at = parseMachineTime(f[1], offset);
    if (!pin || !at) continue;
    const key = `${pin}|${at.getTime()}`;
    if (keys.has(key)) continue;
    keys.add(key);
    if (!latest || at > latest) latest = at;
    rows.push({ pin, at, status: String(f[2] || '').trim(), verify: String(f[3] || '').trim(), workCode: String(f[4] || '').trim() });
  }

  // Clock check. A punch made just now reaches us within a minute or two. If a
  // live punch looks 5–6 hours old, the machine's clock is on UTC: correct it.
  let shift = 0;
  if (latest && process.env.ADMS_AUTO_CLOCK_FIX !== 'off') {
    const drift = (Date.now() - latest.getTime()) / 60000;
    const live = rows.length <= 3 && Boolean(device.lastPunchReceivedAt);
    const behind = offset >= 60 && drift >= offset - 30 && drift <= offset + 30;
    if (live && behind) {
      shift = offset;
      await BiometricDevice.updateOne({ _id: device._id }, { $set: { clockOffsetMinutes: offset, clockCheckedAt: new Date() } });
    } else if (live && drift >= -15 && drift <= 20) {
      if (device.clockOffsetMinutes) await BiometricDevice.updateOne({ _id: device._id }, { $set: { clockOffsetMinutes: 0, clockCheckedAt: new Date() } });
    } else if (device.clockOffsetMinutes && device.clockCheckedAt && Date.now() - new Date(device.clockCheckedAt).getTime() < 6 * 3600000) {
      shift = device.clockOffsetMinutes;
    }
  }
  if (shift) {
    for (const row of rows) row.at = new Date(row.at.getTime() + shift * 60000);
    latest = new Date(latest.getTime() + shift * 60000);
  }

  const now = new Date();
  const docs = rows.map((row) => ({
    tenantId: device.tenantId,
    biometricDeviceMongoId: device._id,
    deviceId: device.deviceId,
    locationName: device.locationName,
    employeeCode: row.pin,
    deviceUserId: row.pin,
    timestamp: row.at,
    punchType: 'UNKNOWN',
    imported: false,
    pending: true,
    source: 'ADMS',
    receivedAt: now,
    raw: { status: row.status, verify: row.verify, workCode: row.workCode || undefined, clockShiftMinutes: shift || undefined }
  }));

  // Punches already stored (the machine sent them again) are skipped by the unique index.
  let added = 0;
  if (docs.length) {
    try {
      const inserted = await RawPunchLog.insertMany(docs, { ordered: false });
      added = inserted.length;
    } catch (error) {
      if (error?.code !== 11000 && !error?.writeErrors) throw error;
      added = error.insertedDocs?.length ?? error.result?.insertedCount ?? Math.max(0, docs.length - (error.writeErrors?.length || 0));
    }
  }

  const set = { status: 'OK', lastSyncAt: now, lastSuccessAt: now, lastError: '', lastImportedCount: added };
  if (query.Stamp) set.attlogStamp = String(query.Stamp).slice(0, 20);
  if (latest && (!device.lastPunchAt || latest > new Date(device.lastPunchAt))) {
    set.lastPunchAt = latest;
    set.lastPunchReceivedAt = now;
  }
  await BiometricDevice.updateOne({ _id: device._id }, { $set: set, $inc: { totalPunches: added } });
  forget(device.serialNumber);
  if (added) {
    console.log(`[ADMS] ${device.name || device.serialNumber}: ${added} new punch${added === 1 ? '' : 'es'} received.`);
    schedule(device._id);
  }
  return all.length;
}

async function receivePeople(device, body, query) {
  const all = lines(body);
  const people = new Map((device.machineUsers || []).map((u) => [u.pin, u.name]));
  for (const line of all) {
    if (/^(FP|FACE|BIODATA|BIOPHOTO|USERPIC|OPLOG|ATTPHOTO)\s/i.test(line)) continue;
    const isUser = /^USER\s/i.test(line) || /(^|\t)PIN=/.test(line);
    if (!isUser) continue;
    const kv = keyValues(line.replace(/^USER\s+/i, ''));
    const pin = cleanPin(kv.PIN);
    if (!pin) continue;
    people.set(pin, String(kv.Name || '').replace(/\s+/g, ' ').trim().slice(0, 60));
  }
  const set = { machineUsers: [...people].slice(0, 5000).map(([pin, name]) => ({ pin, name })) };
  const stamp = query.OpStamp || query.Stamp;
  if (stamp) set.operlogStamp = String(stamp).slice(0, 20);
  await BiometricDevice.updateOne({ _id: device._id }, { $set: set });
  forget(device.serialNumber);
  return all.length;
}

// ---------------------------------------------------------------- attendance

// One worker per machine, so punches are added in time order and never twice at once.
const running = new Map();

function schedule(deviceMongoId) {
  const key = String(deviceMongoId);
  const current = running.get(key);
  if (current) {
    current.again = true;
    return current.promise;
  }
  const state = { again: false };
  state.promise = (async () => {
    let total = { applied: 0, notLinked: 0, waiting: 0, beforeStart: 0 };
    try {
      do {
        state.again = false;
        const r = await processPending(key);
        total = Object.fromEntries(Object.keys(total).map((k) => [k, total[k] + Number(r[k] || 0)]));
      } while (state.again);
    } catch (error) {
      console.error('[ADMS] Adding punches to attendance failed:', error.message);
    } finally {
      running.delete(key);
    }
    return total;
  })();
  running.set(key, state);
  return state.promise;
}

/** Add this machine's saved punches to attendance, oldest first. */
async function processPending(deviceMongoId) {
  const device = await BiometricDevice.findById(deviceMongoId).lean();
  const result = { applied: 0, notLinked: 0, waiting: 0, beforeStart: 0 };
  if (!device) return result;
  const base = { tenantId: device.tenantId, biometricDeviceMongoId: device._id, pending: true };

  if (!device.approved) {
    const r = await RawPunchLog.updateMany(base, { $set: { pending: false, skippedReason: REASONS.WAITING } });
    result.waiting = r.modifiedCount || 0;
    return result;
  }

  const offset = num(device.timezoneOffsetMinutes, DEFAULT_OFFSET());
  const startKey = isDayKey(device.importFrom) ? device.importFrom : dayKeyAt(device.approvedAt || new Date(), offset);
  const before = await RawPunchLog.updateMany({ ...base, timestamp: { $lt: dayStart(startKey, offset) } }, { $set: { pending: false, skippedReason: REASONS.BEFORE_START } });
  result.beforeStart = before.modifiedCount || 0;
  await RawPunchLog.updateMany({ ...base, timestamp: { $gt: new Date(Date.now() + 15 * 60000) } }, { $set: { pending: false, skippedReason: REASONS.FUTURE } });

  const people = new Map();
  for (;;) {
    const batch = await RawPunchLog.find(base).sort({ timestamp: 1 }).limit(200).lean();
    if (!batch.length) break;
    for (const punch of batch) {
      const pin = punch.deviceUserId;
      if (!people.has(pin)) people.set(pin, await findEmployeeForPunch(device.tenantId, { deviceUserId: pin, employeeCode: pin }));
      const employee = people.get(pin);
      if (!employee) {
        await RawPunchLog.updateOne({ _id: punch._id }, { $set: { pending: false, imported: false, skippedReason: REASONS.NOT_LINKED }, $unset: { employeeId: 1, importedAttendanceId: 1 } });
        result.notLinked += 1;
        continue;
      }
      try {
        await applyToAttendance({
          tenantId: device.tenantId,
          rawPunchId: punch._id,
          log: { timestamp: punch.timestamp, punchType: 'UNKNOWN', deviceId: device.deviceId, locationName: punch.locationName || device.locationName },
          employee
        });
        result.applied += 1;
      } catch (error) {
        await RawPunchLog.updateOne({ _id: punch._id }, { $set: { pending: false, imported: false, skippedReason: `Could not add: ${String(error.message || error).slice(0, 150)}` } });
      }
    }
  }
  return result;
}

/** Catch-up for punches left waiting by a restart (runs from the scheduler). */
async function processAllPending() {
  const ids = await RawPunchLog.distinct('biometricDeviceMongoId', { pending: true, source: 'ADMS' });
  for (const id of ids) if (id) await schedule(id);
  return { machines: ids.length };
}

// ---------------------------------------------------------------- HR actions

async function machineOf(tenantId, id) {
  const device = await BiometricDevice.findOne({ _id: id, tenantId, mode: 'ADMS' });
  if (!device) throw new ApiError(404, 'Attendance machine not found');
  return device;
}

function cleanText(value, max = 60) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * HR adds a machine by the serial number shown on it. Adding it is the approval:
 * its punches count as soon as it connects. A machine that already asked to
 * send attendance (waiting) is approved instead.
 */
async function addMachine({ tenantId, userId, serialNumber, name, locationName, importFrom }) {
  const serial = cleanSerial(serialNumber);
  if (serial.length < 5) throw new ApiError(400, 'Type the serial number shown on the machine (Menu → System Info → Device Info).');
  const existing = await BiometricDevice.findOne({ mode: 'ADMS', serialNumber: serial });
  if (existing && String(existing.tenantId) !== String(tenantId)) throw new ApiError(409, 'This machine is already added to another company.');
  if (existing) return { ...(await approveMachine({ tenantId, id: existing._id, userId, name, locationName, importFrom })), added: false };
  const clash = await BiometricDevice.findOne({ tenantId, deviceId: serial });
  if (clash) throw new ApiError(409, `The bridge device "${clash.name}" already uses ${serial} as its Device ID. Change that Device ID first.`);
  const device = await BiometricDevice.create({
    tenantId,
    name: cleanText(name) || 'Attendance machine',
    vendor: 'ESSL',
    deviceId: serial,
    serialNumber: serial,
    locationName: cleanText(locationName) || 'Office',
    mode: 'ADMS',
    enabled: true,
    status: 'READY',
    approved: true,
    approvedAt: new Date(),
    approvedBy: userId,
    importFrom: isDayKey(importFrom) ? importFrom : dayKeyAt(new Date()),
    timezoneOffsetMinutes: DEFAULT_OFFSET()
  });
  forget(serial);
  return { device, added: true };
}

/** Approve a machine: from the start date on, its punches count as attendance. */
async function approveMachine({ tenantId, id, userId, name, locationName, importFrom }) {
  const device = await machineOf(tenantId, id);
  device.approved = true;
  device.approvedAt = new Date();
  device.approvedBy = userId;
  device.importFrom = isDayKey(importFrom) ? importFrom : (device.importFrom || dayKeyAt(new Date()));
  if (cleanText(name)) device.name = cleanText(name);
  if (cleanText(locationName)) device.locationName = cleanText(locationName);
  await device.save();
  forget(device.serialNumber);
  // Punches that were waiting for the approval are added now.
  await RawPunchLog.updateMany(
    { tenantId, biometricDeviceMongoId: device._id, imported: { $ne: true }, skippedReason: { $in: [REASONS.WAITING, REASONS.BEFORE_START] } },
    { $set: { pending: true }, $unset: { skippedReason: 1 } }
  );
  const result = await settle(schedule(device._id));
  return { device, ...result };
}

async function updateMachine({ tenantId, id, name, locationName, importFrom, timezoneOffsetMinutes }) {
  const device = await machineOf(tenantId, id);
  let again = false;
  if (name !== undefined && cleanText(name)) device.name = cleanText(name);
  if (locationName !== undefined && cleanText(locationName)) device.locationName = cleanText(locationName);
  if (importFrom !== undefined && isDayKey(importFrom) && importFrom !== device.importFrom) {
    again = !device.importFrom || importFrom < device.importFrom;
    device.importFrom = importFrom;
  }
  if (timezoneOffsetMinutes !== undefined && Number.isFinite(Number(timezoneOffsetMinutes)) && Math.abs(Number(timezoneOffsetMinutes)) <= 840) {
    device.timezoneOffsetMinutes = Number(timezoneOffsetMinutes);
  }
  await device.save();
  forget(device.serialNumber);
  let result = {};
  if (again && device.approved) {
    // An earlier start date: punches kept from before the old date are added now.
    await RawPunchLog.updateMany(
      { tenantId, biometricDeviceMongoId: device._id, imported: { $ne: true }, skippedReason: REASONS.BEFORE_START },
      { $set: { pending: true }, $unset: { skippedReason: 1 } }
    );
    result = await settle(schedule(device._id));
  }
  return { device, ...result };
}

/** Stop using a machine: its new punches are kept but not added until approved again. */
async function stopMachine({ tenantId, id }) {
  const device = await machineOf(tenantId, id);
  device.approved = false;
  await device.save();
  forget(device.serialNumber);
  return { device };
}

/** Remove a machine that was never approved ("not ours"), with the punches it sent. */
async function removeMachine({ tenantId, id }) {
  const device = await machineOf(tenantId, id);
  if (device.approved) throw new ApiError(400, 'Stop using the machine before removing it.');
  await RawPunchLog.deleteMany({ tenantId, biometricDeviceMongoId: device._id, imported: { $ne: true } });
  await BiometricDevice.deleteOne({ _id: device._id });
  forget(device.serialNumber);
  return { removed: true };
}

/** Add any waiting punches now (normally this happens by itself within seconds). */
async function processNow({ tenantId }) {
  const devices = await BiometricDevice.find({ tenantId, mode: 'ADMS' }).select('_id').lean();
  const totals = { applied: 0, notLinked: 0, waiting: 0, beforeStart: 0 };
  for (const d of devices) {
    const r = await settle(schedule(d._id));
    for (const k of Object.keys(totals)) totals[k] += Number(r[k] || 0);
  }
  return totals;
}

/** Wait for background work, but answer the browser within ~20 seconds. */
async function settle(promise, ms = 20000) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ stillWorking: true }), ms); });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timer);
  return result || {};
}

/**
 * Link a machine ID to an employee (or unlink it with employeeId = null).
 * Punches of that ID that went to someone else move to the right person, and
 * the days of everyone involved are worked out again.
 */
async function linkMachineId({ tenantId, pin: pinValue, employeeId }) {
  const pin = cleanPin(pinValue);
  if (!pin) throw new ApiError(400, 'Machine ID is required');
  let employee = null;
  if (employeeId) {
    employee = await Employee.findOne({ _id: employeeId, tenantId });
    if (!employee) throw new ApiError(404, 'Employee not found');
  }

  await Employee.updateMany(
    { tenantId, 'biometric.deviceUserId': pin, ...(employee ? { _id: { $ne: employee._id } } : {}) },
    { $unset: { 'biometric.deviceUserId': 1 } }
  );
  if (employee) await Employee.updateOne({ _id: employee._id }, { $set: { 'biometric.deviceUserId': pin } });

  // This ID's machine punches (last 120 days) are worked out again for the right person.
  const since = new Date(Date.now() - 120 * 86400000);
  const punches = await RawPunchLog.find({ tenantId, source: 'ADMS', deviceUserId: pin, timestamp: { $gte: since } })
    .select('_id employeeId timestamp biometricDeviceMongoId').lean();
  const target = employee ? String(employee._id) : null;
  const wrong = punches.filter((p) => p.employeeId && String(p.employeeId) !== target);
  const affectedDays = new Map();
  for (const p of wrong) {
    const who = String(p.employeeId);
    if (!affectedDays.has(who)) affectedDays.set(who, new Set());
    affectedDays.get(who).add(dayKeyAt(p.timestamp));
  }

  if (punches.length) {
    await RawPunchLog.updateMany(
      { _id: { $in: punches.filter((p) => !p.employeeId || String(p.employeeId) !== target).map((p) => p._id) } },
      { $set: { pending: true, imported: false }, $unset: { employeeId: 1, importedAttendanceId: 1, skippedReason: 1 } }
    );
  }

  // Take the moved punches out of the previous person's days.
  for (const [who, days] of affectedDays) {
    for (const key of days) {
      // Attendance days are stored as UTC midnight of the India calendar day.
      const date = new Date(`${key}T00:00:00Z`);
      await rebuildAttendanceFromRawPunches({ tenantId, employeeId: who, fromDate: date, toDate: date, reason: `Machine ID ${pin} was linked to someone else` }).catch(() => null);
      await clearTodayIfEmpty({ tenantId, employeeId: who, key });
    }
  }

  // …and add them to the right person.
  const devices = [...new Set(punches.map((p) => String(p.biometricDeviceMongoId || '')).filter(Boolean))];
  let applied = 0;
  for (const id of devices) applied += Number((await settle(schedule(id))).applied || 0);
  return { pin, employeeId: target, moved: wrong.length, punches: punches.length, applied };
}

/** Reprocessing never clears today; drop today's machine-made day when no punch is left. */
async function clearTodayIfEmpty({ tenantId, employeeId, key }) {
  if (key !== dayKeyAt(new Date())) return;
  const from = dayStart(key);
  const to = new Date(from.getTime() + 86400000);
  const left = await RawPunchLog.countDocuments({ tenantId, employeeId, imported: true, timestamp: { $gte: from, $lt: to } });
  if (left) return;
  await Attendance.deleteMany({ tenantId, employeeId, source: 'BIOMETRIC', checkIn: { $gte: from, $lt: to } });
}

// ---------------------------------------------------------------- overview for HR

const RESULT_TEXT = (p) => {
  if (p.pending) return { label: 'Being added…', tone: 'muted' };
  if (p.imported && !p.skippedReason) return { label: 'Added to attendance', tone: 'ok' };
  if (p.skippedReason === REASONS.DUPLICATE) return { label: 'Repeat punch, ignored', tone: 'muted' };
  if (p.skippedReason === REASONS.KEPT_CORRECTION) return { label: 'Day was corrected, kept as is', tone: 'muted' };
  if (p.skippedReason === REASONS.NOT_LINKED) return { label: 'Machine ID not linked', tone: 'warn' };
  if (p.skippedReason === REASONS.WAITING) return { label: 'Machine not approved yet', tone: 'warn' };
  if (p.skippedReason === REASONS.BEFORE_START) return { label: 'Before start date', tone: 'muted' };
  if (p.skippedReason === REASONS.FUTURE) return { label: 'Future time, check machine clock', tone: 'warn' };
  return { label: p.skippedReason || 'Received', tone: p.imported ? 'ok' : 'warn' };
};

const fullName = (e) => `${e?.firstName || ''} ${e?.lastName || ''}`.replace(/\s+/g, ' ').trim();

/** "http://Name.Example.com/x" -> "name.example.com" (port kept). */
function cleanHost(value) {
  return String(value || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/\.$/, '').toLowerCase();
}

/** Where the machine should send to, shown on the setup card. */
function connectInfo(req, saved = {}) {
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const host = (process.env.ADMS_PUBLIC_HOST || forwardedHost || req.get('host') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const [hostName, hostPort] = host.split(':');
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostName || '');
  const secure = !local && (req.secure || String(req.get('x-forwarded-proto') || '').includes('https') || !hostPort);
  const envRelay = cleanHost(process.env.ADMS_RELAY_HOST);
  return {
    host: hostName || '',
    port: Number(process.env.ADMS_PUBLIC_PORT || hostPort || (secure ? 443 : 80)),
    secure,
    appUrl: `${secure ? 'https' : 'http'}://${host}`,
    relayHost: envRelay || cleanHost(saved.relayHost),
    relayFromSettings: Boolean(envRelay),
    relayPort: Number(process.env.ADMS_RELAY_PORT || 80),
    officeRelayPort: 8081,
    pollSeconds: POLL_SECONDS()
  };
}

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+(:\d{2,5})?$/;
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;

/**
 * Asks the relay's own check page (http://relay/) whether it is a JPK relay and
 * which HRMS it passes punches to. Only a yes/no comes back, never the page.
 */
async function checkRelay(host, ownHost) {
  if (process.env.NODE_ENV === 'production' && PRIVATE_HOST.test(host)) {
    return { ok: false, message: 'This is an address inside your office network, so it cannot be checked from here.' };
  }
  try {
    const res = await fetch(`http://${host}/`, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'JPK-HRMS relay check' } });
    const text = (await res.text()).slice(0, 2000);
    if (!/JPK attendance relay/i.test(text)) {
      return { ok: false, message: res.status >= 300 && res.status < 400
        ? 'That address answers only over https, so the machine cannot use it. Use the address Cloudflare gives the relay (it ends in .workers.dev).'
        : 'Something answers at that address, but it is not the JPK relay. Paste the relay code into the Worker and press Deploy.' };
    }
    const target = cleanHost((text.match(/HRMS:\s*(\S+)/i) || [])[1]);
    const nameOf = (h) => cleanHost(h).split(':')[0];
    if (ownHost && target && nameOf(target) !== nameOf(ownHost)) {
      return { ok: false, message: `The relay works but sends punches to ${target}, not to this HRMS. Copy the relay code from this page again and deploy it.` };
    }
    if (/HRMS answer:\s*ok/i.test(text)) return { ok: true, message: 'The relay works and reaches this HRMS.' };
    return { ok: false, message: 'The relay answers, but it could not reach this HRMS yet. Wait a minute and check again.' };
  } catch {
    return { ok: false, message: 'Nothing answered at that address. Check the spelling, and that the Worker is deployed.' };
  }
}

/** Saves (or clears) the relay address for the company and checks it. */
async function saveRelayHost({ tenantId, host, req }) {
  const clean = cleanHost(host);
  if (clean && (clean.length > 120 || !HOST_PATTERN.test(clean))) {
    throw new ApiError(400, 'Type only the address, for example jpk-punch.yourname.workers.dev');
  }
  if (clean && cleanHost(connectInfo(req).host) === clean.split(':')[0]) {
    throw new ApiError(400, 'That is the HRMS address itself. Type the address Cloudflare gives the relay (it ends in .workers.dev).');
  }
  await Tenant.updateOne({ _id: tenantId }, { $set: { admsRelayHost: clean } });
  const connect = connectInfo(req, { relayHost: clean });
  const check = clean ? await checkRelay(clean, connect.host) : null;
  return { relayHost: clean, check, connect };
}

async function overview({ tenantId, req }) {
  const since = new Date(Date.now() - 90 * 86400000);
  const todayStart = dayStart(dayKeyAt(new Date()));
  const [devices, perPin, employees, recent, todayCount, pending, tenant] = await Promise.all([
    BiometricDevice.find({ tenantId, mode: 'ADMS' }).sort({ approved: 1, lastSeenAt: -1 }).lean(),
    RawPunchLog.aggregate([
      { $match: { tenantId: toObjectId(tenantId), source: 'ADMS', timestamp: { $gte: since } } },
      { $group: {
        _id: '$deviceUserId',
        punches: { $sum: 1 },
        lastAt: { $max: '$timestamp' },
        notLinked: { $sum: { $cond: [{ $eq: ['$skippedReason', REASONS.NOT_LINKED] }, 1, 0] } }
      } }
    ]),
    Employee.find({ tenantId, status: { $ne: 'OFFBOARDED' } }).select('firstName lastName employeeCode biometric department').sort({ firstName: 1, lastName: 1 }).lean(),
    RawPunchLog.find({ tenantId, source: 'ADMS' }).sort({ receivedAt: -1, timestamp: -1 }).limit(60)
      .populate('employeeId', 'firstName lastName employeeCode').lean(),
    RawPunchLog.countDocuments({ tenantId, source: 'ADMS', timestamp: { $gte: todayStart } }),
    RawPunchLog.countDocuments({ tenantId, source: 'ADMS', pending: true }),
    Tenant.findById(tenantId).select('admsRelayHost').lean()
  ]);

  // Which employee a machine ID belongs to — the same rule as for punches.
  const byLink = new Map();
  const byCode = new Map();
  const digits = (v) => (/^\d+$/.test(String(v || '')) ? String(v).replace(/^0+/, '') : '');
  for (const e of employees) {
    for (const v of [e.biometric?.deviceUserId, e.biometric?.code]) {
      if (!v) continue;
      byLink.set(String(v).trim(), e);
      if (digits(v)) byLink.set(`#${digits(v)}`, e);
    }
    if (e.employeeCode) byCode.set(String(e.employeeCode).trim(), e);
  }
  const whoIs = (pin) => byLink.get(pin) || byCode.get(pin) || (digits(pin) ? byLink.get(`#${digits(pin)}`) : null) || null;

  const names = new Map();
  for (const d of devices) for (const u of d.machineUsers || []) if (u.name) names.set(u.pin, u.name);
  const pins = new Map();
  for (const row of perPin) pins.set(row._id, { pin: row._id, punches: row.punches, lastAt: row.lastAt, notLinked: row.notLinked });
  for (const [pin] of names) if (!pins.has(pin)) pins.set(pin, { pin, punches: 0, lastAt: null, notLinked: 0 });
  for (const e of employees) {
    const link = e.biometric?.deviceUserId;
    if (link && !pins.has(link)) pins.set(link, { pin: link, punches: 0, lastAt: null, notLinked: 0 });
  }
  const people = [...pins.values()].map((row) => {
    const e = whoIs(row.pin);
    return {
      ...row,
      nameOnMachine: names.get(row.pin) || '',
      employee: e ? { _id: String(e._id), name: fullName(e), employeeCode: e.employeeCode, how: e.biometric?.deviceUserId === row.pin ? 'LINKED' : 'MATCHED' } : null
    };
  }).sort((a, b) => (a.employee ? 1 : 0) - (b.employee ? 1 : 0) || (Number(a.pin) || 1e12) - (Number(b.pin) || 1e12) || String(a.pin).localeCompare(String(b.pin)));

  // Suggest a link when the name stored on the machine clearly belongs to one
  // employee who has no machine ID yet. HR confirms it; nothing is linked by itself.
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const taken = new Set(people.filter((row) => row.employee).map((row) => row.employee._id));
  const free = employees.filter((e) => !e.biometric?.deviceUserId && !taken.has(String(e._id)));
  const suggestFor = (machineName) => {
    const n = norm(machineName);
    if (n.length < 3) return null;
    let found = free.filter((e) => norm(fullName(e)) === n);
    if (!found.length) {
      const [first, second = ''] = n.split(' ');
      found = free.filter((e) => norm(e.firstName) === first && (!second || norm(e.lastName).startsWith(second)));
    }
    return found.length === 1 ? found[0] : null;
  };
  const picks = new Map();
  for (const row of people) {
    if (row.employee || !row.nameOnMachine) continue;
    const e = suggestFor(row.nameOnMachine);
    if (!e) continue;
    const key = String(e._id);
    picks.set(key, picks.has(key) ? null : row); // the same person for two IDs: suggest neither
    row.suggestion = { _id: key, name: fullName(e), employeeCode: e.employeeCode };
  }
  for (const row of people) if (row.suggestion && picks.get(row.suggestion._id) !== row) delete row.suggestion;

  return {
    connect: connectInfo(req, { relayHost: tenant?.admsRelayHost }),
    machines: devices.map((d) => ({
      _id: String(d._id),
      name: d.name,
      serialNumber: d.serialNumber,
      locationName: d.locationName,
      approved: Boolean(d.approved),
      approvedAt: d.approvedAt,
      importFrom: d.importFrom || '',
      firstSeenAt: d.firstSeenAt,
      lastSeenAt: d.lastSeenAt,
      online: Boolean(d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() < ONLINE_MS()),
      lastIp: d.lastIp,
      firmware: d.firmware,
      pushVersion: d.pushVersion,
      machineInfo: d.machineInfo || null,
      peopleOnMachine: (d.machineUsers || []).length || d.machineInfo?.users || 0,
      totalPunches: d.totalPunches || 0,
      lastPunchAt: d.lastPunchAt,
      clockOffsetMinutes: d.clockOffsetMinutes || 0,
      clockCheckedAt: d.clockCheckedAt,
      timezoneOffsetMinutes: d.timezoneOffsetMinutes ?? DEFAULT_OFFSET()
    })),
    people,
    employees: employees.map((e) => ({ _id: String(e._id), name: fullName(e), employeeCode: e.employeeCode, machineId: e.biometric?.deviceUserId || '' })),
    // Active employees no machine ID points to (not linked, not matched by code):
    // the machine cannot count their attendance yet.
    withoutMachineId: free.map((e) => {
      const onMachine = people.find((row) => row.suggestion?._id === String(e._id));
      return {
        _id: String(e._id),
        name: fullName(e),
        employeeCode: e.employeeCode || '',
        department: e.department || '',
        suggestedPin: onMachine ? onMachine.pin : undefined,
        suggestedName: onMachine ? onMachine.nameOnMachine : undefined
      };
    }),
    recent: recent.map((p) => ({
      _id: String(p._id),
      pin: p.deviceUserId,
      at: p.timestamp,
      receivedAt: p.receivedAt,
      machine: devices.find((d) => String(d._id) === String(p.biometricDeviceMongoId))?.name || p.deviceId,
      verify: p.raw?.verify || '',
      employee: p.employeeId ? { _id: String(p.employeeId._id), name: fullName(p.employeeId), employeeCode: p.employeeId.employeeCode } : null,
      ...RESULT_TEXT(p)
    })),
    todayCount,
    pending
  };
}

function toObjectId(id) {
  const mongoose = require('mongoose');
  return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
}

module.exports = {
  REASONS,
  parseMachineTime,
  parseInfo,
  dayKeyAt,
  machineFor,
  handshake,
  receive,
  schedule,
  processPending,
  processAllPending,
  addMachine,
  approveMachine,
  updateMachine,
  stopMachine,
  removeMachine,
  processNow,
  linkMachineId,
  overview,
  connectInfo,
  saveRelayHost,
  checkRelay,
  forget
};

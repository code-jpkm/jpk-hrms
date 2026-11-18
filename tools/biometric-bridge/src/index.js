require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const axios = require('axios');
const cron = require('node-cron');

const PORT = Number(process.env.PORT || 8090);
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
const SYNC_EVERY_MINUTES = Math.max(Number(process.env.SYNC_EVERY_MINUTES || 5), 1);
const CACHE_FILE = path.resolve(process.cwd(), process.env.CACHE_FILE || './data/punch-cache.json');
const HRMS_PUSH_URL = process.env.HRMS_PUSH_URL || '';
const HRMS_PUSH_TOKEN = process.env.HRMS_PUSH_TOKEN || '';

function parseDevices() {
  try {
    const devices = JSON.parse(process.env.DEVICES_JSON || '[]');
    if (!Array.isArray(devices)) return [];
    return devices.map((d) => ({
      id: String(d.id || d.deviceId || '').trim(),
      name: d.name || d.id || d.deviceId,
      ip: d.ip,
      port: Number(d.port || 4370),
      locationName: d.locationName || d.location || d.name || d.id,
      token: d.token || HRMS_PUSH_TOKEN,
      enabled: d.enabled !== false
    })).filter((d) => d.id && d.ip && d.enabled);
  } catch (error) {
    console.error('Invalid DEVICES_JSON:', error.message);
    return [];
  }
}

let devices = parseDevices();
let cache = loadCache();
let lastSync = { status: 'READY', at: null, error: '' };

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Could not load punch cache:', error.message);
    return [];
  }
}

function saveCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    const maxRows = 200000;
    if (cache.length > maxRows) cache = cache.slice(cache.length - maxRows);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.warn('Could not save punch cache:', error.message);
  }
}

function bearerToken(req) {
  const h = req.headers.authorization || '';
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return req.headers['x-bridge-token'] || req.query.token || '';
}

function requireBridgeToken(req, res, next) {
  if (!BRIDGE_TOKEN) return next();
  if (bearerToken(req) === BRIDGE_TOKEN) return next();
  return res.status(401).json({ message: 'Invalid bridge token' });
}

function loadZkLibrary() {
  try {
    const pkg = require('node-zklib');
    return { type: 'node-zklib', lib: pkg };
  } catch (_) {}
  try {
    const pkg = require('zklib-js');
    return { type: 'zklib-js', lib: pkg };
  } catch (_) {}
  return null;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDeviceRow(row, device) {
  const deviceUserId = row.deviceUserId || row.userId || row.uid || row.userSn || row.user_id || row.pin || row.enrollNumber || row.enroll_number || row.employeeCode || row.empCode || row.id;
  const timestamp = toDate(row.timestamp || row.recordTime || row.attendanceTime || row.punchTime || row.verifyTime || row.time || row.datetime || row.VerifyTime || row.attTime);
  if (!timestamp || !deviceUserId) return null;
  const rawType = String(row.punchType || row.type || row.inOut || row.inout || row.state || '').toUpperCase();
  const punchType = rawType.includes('OUT') ? 'OUT' : (rawType.includes('IN') ? 'IN' : 'UNKNOWN');
  return {
    employeeCode: row.employeeCode || row.empCode || row.employee_code || String(deviceUserId),
    deviceUserId: String(deviceUserId),
    timestamp: timestamp.toISOString(),
    punchType,
    deviceId: device.id,
    locationName: device.locationName,
    raw: row
  };
}

function normalizeAttendancePayload(payload, device) {
  const rows = Array.isArray(payload) ? payload : (payload?.data || payload?.logs || payload?.attendances || payload?.records || []);
  return rows.map((row) => normalizeDeviceRow(row, device)).filter(Boolean);
}

async function connectAndReadDevice(device) {
  const adapter = loadZkLibrary();
  if (!adapter) {
    throw new Error('No ZKTeco library installed. Run: npm install node-zklib OR install vendor SDK adapter in biometric-bridge.');
  }

  if (adapter.type === 'node-zklib') {
    const ZKLib = adapter.lib.default || adapter.lib;
    const zk = new ZKLib(device.ip, device.port || 4370, 10000, 4000);
    try {
      await zk.createSocket();
      const payload = await zk.getAttendances();
      return normalizeAttendancePayload(payload, device);
    } finally {
      try { await zk.disconnect(); } catch (_) {}
    }
  }

  if (adapter.type === 'zklib-js') {
    const ZKLib = adapter.lib.default || adapter.lib;
    const zk = new ZKLib(device.ip, device.port || 4370, 10000, 4000);
    try {
      if (typeof zk.createSocket === 'function') await zk.createSocket();
      if (typeof zk.connect === 'function') await zk.connect();
      const payload = typeof zk.getAttendances === 'function' ? await zk.getAttendances() : await zk.getAttendanceRecords();
      return normalizeAttendancePayload(payload, device);
    } finally {
      try { if (typeof zk.disconnect === 'function') await zk.disconnect(); } catch (_) {}
    }
  }

  throw new Error('Unsupported ZK library adapter');
}

function punchKey(p) {
  return `${p.deviceId}|${p.deviceUserId || p.employeeCode}|${new Date(p.timestamp).toISOString()}`;
}

function addToCache(punches) {
  const existing = new Set(cache.map(punchKey));
  const fresh = [];
  for (const punch of punches) {
    const key = punchKey(punch);
    if (existing.has(key)) continue;
    cache.push(punch);
    existing.add(key);
    fresh.push(punch);
  }
  if (fresh.length) saveCache();
  return fresh;
}

async function pushToHrms(device, punches) {
  if (!HRMS_PUSH_URL || !punches.length) return { skipped: true };
  const url = `${HRMS_PUSH_URL.replace(/\/$/, '')}/${encodeURIComponent(device.id)}`;
  const token = device.token || HRMS_PUSH_TOKEN;
  const response = await axios.post(url, { logs: punches }, {
    headers: token ? { 'x-device-token': token } : undefined,
    timeout: 30000
  });
  return response.data;
}

async function syncOne(device) {
  const logs = await connectAndReadDevice(device);
  const fresh = addToCache(logs);
  const pushResult = await pushToHrms(device, fresh);
  return { deviceId: device.id, name: device.name, totalFromMachine: logs.length, newCached: fresh.length, pushed: pushResult };
}

async function syncAll() {
  devices = parseDevices();
  lastSync = { status: 'SYNCING', at: new Date().toISOString(), error: '' };
  const results = [];
  for (const device of devices) {
    try {
      results.push(await syncOne(device));
    } catch (error) {
      results.push({ deviceId: device.id, name: device.name, error: error.message });
    }
  }
  lastSync = { status: results.some((r) => r.error) ? 'PARTIAL_ERROR' : 'OK', at: new Date().toISOString(), error: results.filter((r) => r.error).map((r) => `${r.deviceId}: ${r.error}`).join('; ') };
  return results;
}

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ ok: true, service: 'hrms-biometric-bridge', devices: devices.length, lastSync, cacheRows: cache.length }));
app.get('/devices', requireBridgeToken, (req, res) => res.json({ devices: parseDevices().map((d) => ({ id: d.id, name: d.name, ip: d.ip, port: d.port, locationName: d.locationName, enabled: d.enabled })) }));

app.get('/attendance', requireBridgeToken, (req, res) => {
  const { deviceId, since } = req.query;
  const sinceDate = since ? new Date(since) : null;
  let logs = cache;
  if (deviceId) logs = logs.filter((p) => p.deviceId === deviceId);
  if (sinceDate && !Number.isNaN(sinceDate.getTime())) logs = logs.filter((p) => new Date(p.timestamp) > sinceDate);
  res.json({ logs, count: logs.length, lastSync });
});

app.post('/sync-now', requireBridgeToken, async (req, res) => {
  try {
    const results = await syncAll();
    res.json({ results, lastSync });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/test-device/:deviceId', requireBridgeToken, async (req, res) => {
  const device = parseDevices().find((d) => d.id === req.params.deviceId);
  if (!device) return res.status(404).json({ message: 'Device not found in bridge DEVICES_JSON' });
  try {
    const logs = await connectAndReadDevice(device);
    res.json({ ok: true, deviceId: device.id, sampleCount: logs.length, sample: logs.slice(0, 5) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/attendance', requireBridgeToken, (req, res) => {
  const deviceId = req.body.deviceId;
  const device = parseDevices().find((d) => d.id === deviceId) || { id: deviceId || 'MANUAL', locationName: req.body.locationName || 'Manual' };
  const logs = normalizeAttendancePayload(req.body.logs || req.body.data || [], device);
  const fresh = addToCache(logs);
  res.status(201).json({ total: logs.length, newCached: fresh.length });
});

cron.schedule(`*/${SYNC_EVERY_MINUTES} * * * *`, () => {
  syncAll().catch((error) => {
    lastSync = { status: 'ERROR', at: new Date().toISOString(), error: error.message };
    console.error('Scheduled biometric sync failed:', error);
  });
});

app.listen(PORT, () => {
  console.log(`Biometric bridge running on http://localhost:${PORT}`);
  console.log(`Configured devices: ${devices.map((d) => d.id).join(', ') || 'none'}`);
  console.log(`Auto sync every ${SYNC_EVERY_MINUTES} minute(s).`);
});

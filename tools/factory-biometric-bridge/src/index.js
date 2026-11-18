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
const DEVICE_ID = String(process.env.DEVICE_ID || '').trim();
const DEVICE_NAME = process.env.DEVICE_NAME || DEVICE_ID || 'ESSL Device';
const DEVICE_IP = process.env.DEVICE_IP || '';
const DEVICE_PORT = Number(process.env.DEVICE_PORT || 4370);
const LOCATION_NAME = process.env.LOCATION_NAME || DEVICE_NAME || DEVICE_ID;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || '';
const HRMS_API_URL = (process.env.HRMS_API_URL || '').replace(/\/$/, '');
const SYNC_EVERY_MINUTES = Math.max(Number(process.env.SYNC_EVERY_MINUTES || 5), 1);
const CACHE_FILE = path.resolve(process.cwd(), process.env.CACHE_FILE || './data/push-cache.json');
const MAX_PUSH_BATCH = Math.max(Number(process.env.MAX_PUSH_BATCH || 500), 1);
const START_SYNC_ON_BOOT = String(process.env.START_SYNC_ON_BOOT || 'true').toLowerCase() !== 'false';

function mustHave(value, name) {
  if (!value) throw new Error(`${name} is required in .env`);
}

function validateEnv() {
  mustHave(DEVICE_ID, 'DEVICE_ID');
  mustHave(DEVICE_IP, 'DEVICE_IP');
  mustHave(DEVICE_TOKEN, 'DEVICE_TOKEN');
  mustHave(HRMS_API_URL, 'HRMS_API_URL');
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Could not load push cache:', error.message);
    return [];
  }
}

let cache = loadCache();
let lastSync = { status: 'READY', at: null, error: '', fetched: 0, queued: 0, pushed: 0 };

function saveCache() {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  const maxRows = 250000;
  if (cache.length > maxRows) cache = cache.slice(cache.length - maxRows);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function bearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
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
    return { type: 'node-zklib', lib: pkg.default || pkg };
  } catch (_) {}
  try {
    const pkg = require('zklib-js');
    return { type: 'zklib-js', lib: pkg.default || pkg };
  } catch (_) {}
  return null;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDeviceRow(row) {
  const deviceUserId = row.deviceUserId || row.userId || row.uid || row.userSn || row.user_id || row.pin || row.enrollNumber || row.enroll_number || row.employeeCode || row.empCode || row.id;
  const timestamp = toDate(row.timestamp || row.recordTime || row.attendanceTime || row.punchTime || row.verifyTime || row.time || row.datetime || row.VerifyTime || row.attTime || row.snTime);
  if (!timestamp || !deviceUserId) return null;
  const rawType = String(row.punchType || row.type || row.inOut || row.inout || row.state || row.status || '').toUpperCase();
  const punchType = rawType.includes('OUT') ? 'OUT' : (rawType.includes('IN') ? 'IN' : 'UNKNOWN');
  return {
    employeeCode: row.employeeCode || row.empCode || row.employee_code || String(deviceUserId),
    deviceUserId: String(deviceUserId),
    timestamp: timestamp.toISOString(),
    punchType,
    deviceId: DEVICE_ID,
    locationName: LOCATION_NAME,
    raw: row
  };
}

function normalizeAttendancePayload(payload) {
  const rows = Array.isArray(payload) ? payload : (payload?.data || payload?.logs || payload?.attendances || payload?.records || []);
  return rows.map(normalizeDeviceRow).filter(Boolean);
}

async function readMachine() {
  const adapter = loadZkLibrary();
  if (!adapter) {
    throw new Error('No ZKTeco/ESSL library installed. Run: npm install node-zklib. If your machine model needs vendor SDK, replace readMachine() adapter only.');
  }

  const ZKLib = adapter.lib;
  const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, 10000, 4000);
  try {
    if (typeof zk.createSocket === 'function') await zk.createSocket();
    if (typeof zk.connect === 'function') await zk.connect();
    const payload = typeof zk.getAttendances === 'function' ? await zk.getAttendances() : await zk.getAttendanceRecords();
    return normalizeAttendancePayload(payload);
  } finally {
    try { if (typeof zk.disconnect === 'function') await zk.disconnect(); } catch (_) {}
  }
}

function punchKey(p) {
  return `${p.deviceId}|${p.deviceUserId || p.employeeCode}|${new Date(p.timestamp).toISOString()}`;
}

function addToQueue(punches) {
  const existing = new Set(cache.map((row) => row.key || punchKey(row.punch || row)));
  const fresh = [];
  for (const punch of punches) {
    const key = punchKey(punch);
    if (existing.has(key)) continue;
    const queued = { key, punch, queuedAt: new Date().toISOString(), pushedAt: null, pushAttempts: 0, pushError: '' };
    cache.push(queued);
    existing.add(key);
    fresh.push(queued);
  }
  if (fresh.length) saveCache();
  return fresh;
}

function pendingRows() {
  return cache.filter((row) => !row.pushedAt);
}

async function pushPending() {
  const pending = pendingRows().slice(0, MAX_PUSH_BATCH);
  if (!pending.length) return { pushed: 0, pending: 0, skipped: true };
  const url = `${HRMS_API_URL}/biometric/public-push/${encodeURIComponent(DEVICE_ID)}`;
  const logs = pending.map((row) => row.punch);
  try {
    const response = await axios.post(url, { logs, bridge: { deviceId: DEVICE_ID, deviceName: DEVICE_NAME, locationName: LOCATION_NAME } }, {
      headers: { 'x-device-token': DEVICE_TOKEN },
      timeout: 30000
    });
    const now = new Date().toISOString();
    for (const row of pending) {
      row.pushedAt = now;
      row.pushError = '';
      row.pushResponse = response.data;
    }
    saveCache();
    return { pushed: pending.length, pending: pendingRows().length, hrms: response.data };
  } catch (error) {
    for (const row of pending) {
      row.pushAttempts = Number(row.pushAttempts || 0) + 1;
      row.lastPushAttemptAt = new Date().toISOString();
      row.pushError = error.response?.data?.message || error.message;
    }
    saveCache();
    throw error;
  }
}

async function syncNow() {
  validateEnv();
  lastSync = { ...lastSync, status: 'SYNCING', at: new Date().toISOString(), error: '' };
  try {
    const logs = await readMachine();
    const fresh = addToQueue(logs);
    const pushResult = await pushPending();
    lastSync = { status: 'OK', at: new Date().toISOString(), error: '', fetched: logs.length, queued: fresh.length, pushed: pushResult.pushed || 0, pending: pushResult.pending || 0 };
    return { deviceId: DEVICE_ID, deviceName: DEVICE_NAME, fetched: logs.length, newQueued: fresh.length, ...pushResult };
  } catch (error) {
    lastSync = { status: 'ERROR', at: new Date().toISOString(), error: error.response?.data?.message || error.message, fetched: 0, queued: 0, pushed: 0, pending: pendingRows().length };
    throw error;
  }
}

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

app.get('/health', (req, res) => res.json({ ok: true, service: 'hrms-biometric-push-bridge', mode: 'PUSH', deviceId: DEVICE_ID, deviceName: DEVICE_NAME, deviceIp: DEVICE_IP, locationName: LOCATION_NAME, lastSync, cacheRows: cache.length, pendingRows: pendingRows().length, hrmsApiUrl: HRMS_API_URL }));

app.get('/queue', requireBridgeToken, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  res.json({ rows: cache.slice(-limit).reverse(), total: cache.length, pending: pendingRows().length });
});

app.post('/test-device', requireBridgeToken, async (req, res) => {
  try {
    validateEnv();
    const logs = await readMachine();
    res.json({ ok: true, deviceId: DEVICE_ID, deviceName: DEVICE_NAME, sampleCount: logs.length, sample: logs.slice(0, 5) });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/sync-now', requireBridgeToken, async (req, res) => {
  try {
    const result = await syncNow();
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, message: error.response?.data?.message || error.message, lastSync });
  }
});

app.post('/push-pending', requireBridgeToken, async (req, res) => {
  try {
    validateEnv();
    const result = await pushPending();
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, message: error.response?.data?.message || error.message, pending: pendingRows().length });
  }
});

// Manual local test import. It queues rows and pushes them to HRMS using the same PUSH endpoint.
app.post('/manual-queue', requireBridgeToken, async (req, res) => {
  try {
    validateEnv();
    const logs = normalizeAttendancePayload(req.body.logs || req.body.data || []);
    const fresh = addToQueue(logs);
    const pushResult = await pushPending();
    res.status(201).json({ total: logs.length, newQueued: fresh.length, ...pushResult });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.response?.data?.message || error.message });
  }
});

cron.schedule(`*/${SYNC_EVERY_MINUTES} * * * *`, () => {
  syncNow().catch((error) => console.error('Scheduled push sync failed:', error.response?.data || error.message));
});

app.listen(PORT, () => {
  console.log(`${DEVICE_NAME} push bridge running on http://localhost:${PORT}`);
  console.log(`Device: ${DEVICE_ID} at ${DEVICE_IP}:${DEVICE_PORT}`);
  console.log(`Push target: ${HRMS_API_URL}/biometric/public-push/${DEVICE_ID}`);
  console.log(`Auto push every ${SYNC_EVERY_MINUTES} minute(s).`);
  if (START_SYNC_ON_BOOT) setTimeout(() => syncNow().catch((error) => console.error('Startup sync failed:', error.message)), 2000);
});

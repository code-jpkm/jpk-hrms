# HRMS Biometric Bridge for ESSL / ZKTeco Machines

> **There is a simpler way now (v26.3).** If your machine has **ADMS / Cloud Server** in its COMM menu (most eSSL machines do), it can send punches to the HRMS by itself. You don't need this bridge, device IDs or tokens. See `machine-relay/README.md` and the **Attendance machines** page in the HRMS. Use this bridge only for machines without that menu.

Run this small Node service on a computer/server that is on the same LAN/VPN as the fingerprint machines. The main HRMS server can then pull attendance from this bridge every 5 minutes, or the bridge can push new punches to HRMS.

## Why this bridge exists

Most ESSL/ZKTeco machines are inside the office/factory LAN and cannot be reached directly from a cloud-hosted HRMS server. This bridge solves that by running locally near the machines.

## Setup

```bash
cd biometric-bridge
cp .env.example .env
npm install
npm run dev
```

Open:

```text
http://localhost:8090/health
```

## Configure devices

Edit `.env`:

```env
PORT=8090
BRIDGE_TOKEN=your_bridge_token
SYNC_EVERY_MINUTES=5
DEVICES_JSON=[{"id":"FACTORY-ZK-01","name":"Factory ESSL","ip":"192.168.1.201","port":4370,"locationName":"Factory","token":"factory_device_token"},{"id":"OFFICE-ZK-01","name":"Office ESSL","ip":"192.168.1.202","port":4370,"locationName":"Office","token":"office_device_token"}]
```

The bridge tries to use `node-zklib` first, then `zklib-js`. If your model needs a different SDK, replace `connectAndReadDevice()` in `src/index.js` only; the HRMS side will not need changes.

## HRMS HTTP_PULL mode

In HRMS → Biometric Devices, create one device per machine:

Factory:

```text
Device ID: FACTORY-ZK-01
Mode: HTTP_PULL
API URL: http://YOUR_BRIDGE_IP:8090/attendance
API Token: your_bridge_token
Sync minutes: 5
```

Office:

```text
Device ID: OFFICE-ZK-01
Mode: HTTP_PULL
API URL: http://YOUR_BRIDGE_IP:8090/attendance
API Token: your_bridge_token
Sync minutes: 5
```

The HRMS server calls:

```text
GET /attendance?deviceId=FACTORY-ZK-01&since=2026-06-01T00:00:00.000Z
Authorization: Bearer your_bridge_token
```

## PUSH mode instead of pull

Set:

```env
HRMS_PUSH_URL=http://YOUR_HRMS_SERVER:5001/api/biometric/public-push
```

For each HRMS biometric device, set `API Token` to the same token used for that device in `DEVICES_JSON`. The bridge will POST new punches to:

```text
POST /api/biometric/public-push/:deviceId
x-device-token: <device token>
```

## Endpoints

```text
GET  /health
GET  /devices
GET  /attendance?deviceId=FACTORY-ZK-01&since=ISO_DATE
POST /sync-now
POST /test-device/:deviceId
```

## Notes

- The machine must be reachable from this bridge computer on port 4370 or the configured port.
- Employee `biometric.code` in HRMS should match the fingerprint machine enroll number/PIN.
- Keep the bridge running with PM2/systemd/launchd in production.

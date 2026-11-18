# Two-location biometric PUSH bridges

> **There is a simpler way now (v26.3).** If your machine has **ADMS / Cloud Server** in its COMM menu (most eSSL machines do), it can send punches to the HRMS by itself. You don't need this bridge, device IDs or tokens. See `machine-relay/README.md` and the **Attendance machines** page in the HRMS. Use this bridge only for machines without that menu.

This folder is for the real setup where the factory and office are far apart.

Use one bridge on each location desktop:

```text
Factory fingerprint machine -> factory desktop bridge -> central HRMS
Office fingerprint machine  -> office desktop bridge  -> central HRMS
```

The bridge reads the local fingerprint machine on LAN port 4370 and PUSHES new punches to:

```text
POST <HRMS_API_URL>/biometric/public-push/<DEVICE_ID>
x-device-token: <DEVICE_TOKEN>
```

The bridge keeps a local cache. If internet/HRMS is down, punches remain pending and are retried every 5 minutes.

## Factory desktop

```bash
cd factory-biometric-bridge
cp .env.example .env
npm install
npm install node-zklib
npm run dev
```

Edit `.env` and set:

```env
DEVICE_ID=FACTORY-ZK-01
DEVICE_IP=<factory fingerprint machine IP>
DEVICE_TOKEN=<same token as HRMS factory device API Token>
HRMS_API_URL=https://hrms.yourcompany.com/api
```

Test:

```bash
curl http://localhost:8090/health
curl -X POST -H "x-bridge-token: factory_bridge_admin_token" http://localhost:8090/test-device
curl -X POST -H "x-bridge-token: factory_bridge_admin_token" http://localhost:8090/sync-now
```

## Office desktop

```bash
cd office-biometric-bridge
cp .env.example .env
npm install
npm install node-zklib
npm run dev
```

Edit `.env` and set:

```env
DEVICE_ID=OFFICE-ZK-01
DEVICE_IP=<office fingerprint machine IP>
DEVICE_TOKEN=<same token as HRMS office device API Token>
HRMS_API_URL=https://hrms.yourcompany.com/api
```

Test:

```bash
curl http://localhost:8091/health
curl -X POST -H "x-bridge-token: office_bridge_admin_token" http://localhost:8091/test-device
curl -X POST -H "x-bridge-token: office_bridge_admin_token" http://localhost:8091/sync-now
```

## HRMS device setup

In HRMS -> Biometric Devices create two devices:

Factory:

```text
Device ID: FACTORY-ZK-01
Mode: PUSH
API Token: factory_device_token
Enabled: Yes
```

Office:

```text
Device ID: OFFICE-ZK-01
Mode: PUSH
API Token: office_device_token
Enabled: Yes
```

The Device ID and API Token must match the bridge `.env` exactly.

## Keep bridge running permanently

On the factory/office desktop:

```bash
npm install -g pm2
pm2 start src/index.js --name factory-biometric-bridge
pm2 save
pm2 startup
```

For office use name `office-biometric-bridge`.

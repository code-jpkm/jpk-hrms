#!/usr/bin/env node
// JPK HRMS — attendance relay.
//
// Most eSSL / ZKTeco machines can only send plain "http", while the HRMS on the
// internet only accepts secure "https". This small program runs on any computer
// in the same office network as the machine and passes everything on:
//
//   attendance machine ──http──▶ this computer (port 8081) ──https──▶ HRMS
//
// Needs Node.js 18 or newer (https://nodejs.org). Nothing else to install.
//
//   Windows: double-click start-relay.bat (it sets the HRMS address).
//   Or:      APP_URL=https://your-hrms-api.onrender.com node attendance-relay.js
//
// On the machine (Menu → COMM → Cloud Server Setting):
//   Server Mode ADMS · Enable Domain Name OFF · Server Address = this computer's IP
//   Server Port 8081 · Enable Proxy Server OFF
//
// Keep this window open (or start it with the computer). Nothing is stored here.
'use strict';

const http = require('http');
const os = require('os');

const APP_URL = String(process.env.APP_URL || process.argv[2] || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
const PORT = Number(process.env.PORT || 8081);
const TIMEOUT_MS = Number(process.env.RELAY_TIMEOUT_MS || 90000); // a sleeping server can take a minute to wake up

if (!/^https?:\/\//.test(APP_URL)) {
  console.error('\n  The HRMS address is missing.');
  console.error('  Start it like this:  APP_URL=https://your-hrms-api.onrender.com node attendance-relay.js');
  console.error('  (On Windows, edit the APP_URL line in start-relay.bat.)\n');
  process.exit(1);
}

const time = () => new Date().toLocaleTimeString();
const serialOf = (url) => (String(url).match(/[?&]SN=([^&]+)/i) || [])[1] || '';
const seenMachines = new Map();

const server = http.createServer(async (req, res) => {
  const chunks = [];
  try {
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    // Only the machine's addresses are passed on; anything else gets a plain OK.
    if (!req.url.startsWith('/iclock/')) {
      const hello = 'JPK attendance relay is running.';
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(hello) });
      res.end(hello);
      return;
    }
    const upstream = await fetch(new URL(req.url, APP_URL), {
      method: req.method,
      headers: { 'Content-Type': req.headers['content-type'] || 'text/plain', 'X-Forwarded-For': req.socket.remoteAddress || '' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const out = Buffer.from(await upstream.arrayBuffer());
    // The machine sets its clock from this header.
    // A plain length (no "chunked" answers): older machine firmware expects it.
    const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': out.length };
    if (upstream.headers.get('date')) headers.Date = upstream.headers.get('date');
    res.writeHead(upstream.status, headers);
    res.end(out);

    const sn = serialOf(req.url);
    const reply = out.toString().trim().split('\n')[0];
    if (/table=ATTLOG/i.test(req.url)) console.log(`${time()}  ✔ punches from ${sn} → HRMS answered ${reply}`);
    else if (/options=all/i.test(req.url)) console.log(`${time()}  ✔ machine ${sn} connected (HRMS answered ${upstream.status})`);
    else if (!seenMachines.has(sn)) console.log(`${time()}  ✔ machine ${sn} is checking in`);
    seenMachines.set(sn, Date.now());
    if (upstream.status >= 400) console.log(`${time()}  ! HRMS answered ${upstream.status}: ${reply}`);
  } catch (error) {
    console.error(`${time()}  ✖ could not reach the HRMS (${error.name === 'TimeoutError' ? 'no answer in time' : error.message}). The machine will try again.`);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain', 'Content-Length': 5 });
    res.end('ERROR');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use — is the relay already running in another window?\n`);
  else console.error(error.message);
  process.exit(1);
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('');
  console.log('  JPK attendance relay is running');
  console.log(`  HRMS: ${APP_URL}`);
  console.log('');
  console.log('  On the attendance machine (Menu → COMM → Cloud Server Setting):');
  console.log('    Server Mode ........ ADMS');
  console.log('    Enable Domain Name . OFF');
  console.log(`    Server Address ..... ${ips[0] || "this computer's IP address"}${ips.length > 1 ? `   (or ${ips.slice(1).join(', ')})` : ''}`);
  console.log(`    Server Port ........ ${PORT}`);
  console.log('    Enable Proxy Server  OFF');
  console.log('');
  console.log('  Keep this window open. Waiting for the machine…');
  console.log('');
  // Say hello to the HRMS once, so a wrong address shows up straight away.
  fetch(new URL('/health', APP_URL), { signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then((r) => console.log(`${time()}  ✔ HRMS reachable (${r.status})`))
    .catch((e) => console.log(`${time()}  ! HRMS not reachable yet: ${e.message}. Check the address in start-relay.bat.`));
});

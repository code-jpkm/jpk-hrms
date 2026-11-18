// The Cloudflare relay for attendance machines (same as tools/machine-relay/cloudflare-worker.js).
// The Attendance machines page fills in this HRMS's address and offers it to copy.

const CODE = `// JPK HRMS — attendance relay on Cloudflare (free, no computer needed).
//
// Most eSSL / ZKTeco machines can only send plain "http", but the HRMS on Render
// only accepts "https". This small Worker sits in between: the machine sends to
// it over http, it passes everything on to the HRMS over https and hands the
// HRMS's answer back to the machine.
//
// Set up once (about 5 minutes, free Cloudflare account, no card needed):
//   1. dash.cloudflare.com → Workers & Pages → Create → Start with Hello World!
//      → name it jpk-punch → Deploy.
//   2. Edit code → replace everything with this file → Deploy.
//   3. Copy the address Cloudflare shows (jpk-punch.<your-name>.workers.dev) and
//      save it in the HRMS: Attendance machines → Through Cloudflare.
// To check it, open that address in a browser: it shows "JPK attendance relay"
// and whether it reaches the HRMS.
//
// On the machine, Menu → COMM → Cloud Server Setting: Server Mode ADMS ·
// Enable Domain Name ON · Server Address = the workers.dev address ·
// Server Port 80 (if it asks) · Enable Proxy Server OFF.
// Menu → COMM → Ethernet: Subnet Mask 255.255.255.0 · Gateway = your router ·
// DNS 8.8.8.8.

const HRMS_URL = '__HRMS_URL__';

export default {
  async fetch(request, env) {
    const hrms = hrmsAddress((env && env.HRMS_URL) || HRMS_URL);
    const url = new URL(request.url);
    if (!/^\\/iclock\\//i.test(url.pathname)) return checkPage(hrms);

    const headers = new Headers({
      'Content-Type': request.headers.get('Content-Type') || 'text/plain',
      'User-Agent': request.headers.get('User-Agent') || 'iClock',
      'X-Relay-Client-IP': request.headers.get('CF-Connecting-IP') || ''
    });
    const init = { method: request.method, headers, redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
    try {
      const res = await fetch(hrms + url.pathname + url.search, init);
      const out = new Headers({
        'Content-Type': res.headers.get('Content-Type') || 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      const date = res.headers.get('Date');
      if (date) out.set('Date', date);
      const body = request.method === 'HEAD' ? null : await res.arrayBuffer();
      return new Response(body, { status: res.status, headers: out });
    } catch (error) {
      // The machine keeps its punches and sends them again on its next try.
      return new Response('ERROR', { status: 502, headers: { 'Content-Type': 'text/plain' } });
    }
  }
};

// The HRMS on Render only answers https; keep plain http only for a local test.
function hrmsAddress(value) {
  let v = String(value || '').trim().replace(/\\/+$/, '');
  if (!/^https?:\\/\\//i.test(v)) v = \`https://\${v}\`;
  if (/^http:\\/\\//i.test(v) && !/^http:\\/\\/(localhost|\\d+\\.\\d+\\.\\d+\\.\\d+)(:\\d+)?$/i.test(v)) v = \`https://\${v.slice(7)}\`;
  return v;
}

async function checkPage(hrms) {
  let answer;
  try {
    const res = await fetch(\`\${hrms}/health\`, { headers: { 'User-Agent': 'JPK attendance relay' } });
    answer = res.ok ? 'ok' : \`HTTP \${res.status}\`;
  } catch (error) {
    answer = 'not reachable';
  }
  return new Response(\`JPK attendance relay\\nHRMS: \${hrms}\\nHRMS answer: \${answer}\\n\`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
`;

export function relayWorkerCode(appUrl) {
  return CODE.replace('__HRMS_URL__', String(appUrl || '').replace(/\/+$/, ''));
}

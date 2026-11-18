// JPK HRMS — attendance relay on Cloudflare (no computer needed).
//
// For machines that can only send plain "http". The machine sends to this Worker
// over http; the Worker passes everything on to the HRMS over https and hands the
// answer back to the machine.
//
// One-time setup (by whoever manages the company domain on Cloudflare):
//   1. Workers & Pages → Create → Worker → paste this file → Deploy.
//   2. Worker → Settings → Variables and Secrets → add APP_URL = https://your-hrms-api.onrender.com
//   3. Worker → Settings → Domains & Routes → add a Custom Domain, e.g. punch.yourcompany.com
//   4. The machine must be able to use plain http on that name: in SSL/TLS → Edge
//      Certificates, "Always Use HTTPS" must not apply to punch.yourcompany.com. If it is
//      on for the whole domain, turn it off and add a Redirect Rule that sends http to
//      https for every other host name (Cloudflare docs: "Always Use HTTPS").
//   5. In the HRMS server settings set ADMS_RELAY_HOST=punch.yourcompany.com so the
//      Attendance machines page shows this address.
//
// On the machine (Menu → COMM → Cloud Server Setting):
//   Server Mode ADMS · Enable Domain Name ON · Server Address punch.yourcompany.com
//   Server Port 80 · Enable Proxy Server OFF
// and under Menu → COMM → Ethernet: Gateway = your router, DNS = 8.8.8.8.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/iclock/')) return new Response('JPK attendance relay', { status: 200 });
    const target = new URL(url.pathname + url.search, env.APP_URL);
    const init = {
      method: request.method,
      headers: {
        'Content-Type': request.headers.get('Content-Type') || 'text/plain',
        'X-Forwarded-For': request.headers.get('CF-Connecting-IP') || ''
      }
    };
    if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
    try {
      const res = await fetch(target, init);
      const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
      if (res.headers.get('date')) headers.Date = res.headers.get('date');
      return new Response(await res.arrayBuffer(), { status: res.status, headers });
    } catch {
      // The machine keeps its punches and sends them again later.
      return new Response('ERROR', { status: 502, headers: { 'Content-Type': 'text/plain' } });
    }
  }
};

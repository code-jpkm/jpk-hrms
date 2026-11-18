// Addresses an attendance machine in "ADMS" / "Cloud Server" mode calls by itself.
// Mounted at /iclock before the JSON parsers: machines send plain text, and some
// add ".aspx" to every address (/iclock/cdata.aspx).
const express = require('express');
const rateLimit = require('express-rate-limit');
const adms = require('../services/admsService');

const router = express.Router();

router.use(rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.ADMS_RATE_LIMIT_PER_MINUTE || 600),
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).type('text/plain').send('ERROR: too many requests')
}));
router.use(express.text({ type: () => true, limit: process.env.ADMS_MAX_BODY || '20mb' }));

function reply(res, body, status = 200) {
  return res.status(status).set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).send(body);
}
const paths = (name) => [`/${name}`, `/${name}.aspx`];
const bodyText = (req) => (typeof req.body === 'string' ? req.body : '');
const ipOf = (req) => String(req.ip || '').replace(/^::ffff:/, '');
const serialOf = (req) => req.query.SN || req.query.sn || '';

// First call after start-up (?options=all): tell the machine what to send.
router.get(paths('cdata'), async (req, res) => {
  try {
    const device = await adms.machineFor(serialOf(req), { ip: ipOf(req), pushVersion: req.query.pushver });
    if (device && req.query.options) return reply(res, adms.handshake(device));
    return reply(res, 'OK');
  } catch (error) {
    console.error('[ADMS] handshake failed:', error.message);
    return reply(res, 'ERROR', 500);
  }
});

// Punches (table=ATTLOG) and the people on the machine (table=OPERLOG).
router.post(paths('cdata'), async (req, res) => {
  try {
    const device = await adms.machineFor(serialOf(req), { ip: ipOf(req), pushVersion: req.query.pushver });
    // Not accepted: answer with an error so the machine keeps its punches and tries again later.
    if (!device) return reply(res, 'ERROR: machine not registered', 403);
    const count = await adms.receive(device, req.query.table, bodyText(req), req.query);
    return reply(res, `OK: ${count}`);
  } catch (error) {
    // The machine sends the same punches again after an error, so nothing is lost.
    console.error('[ADMS] saving punches failed:', error.message);
    return reply(res, 'ERROR', 500);
  }
});

// "Any commands for me?" every half minute (also how we know the machine is online).
router.get(paths('getrequest'), async (req, res) => {
  try {
    await adms.machineFor(serialOf(req), { ip: ipOf(req), info: adms.parseInfo(req.query.INFO) });
  } catch (error) {
    console.error('[ADMS] check-in failed:', error.message);
  }
  return reply(res, 'OK');
});

router.post(paths('devicecmd'), async (req, res) => {
  try { await adms.machineFor(serialOf(req), { ip: ipOf(req) }); } catch { /* answered below */ }
  return reply(res, 'OK');
});

router.get(paths('ping'), async (req, res) => {
  try { await adms.machineFor(serialOf(req), { ip: ipOf(req) }); } catch { /* answered below */ }
  return reply(res, 'OK');
});

// Newer firmware registers first; older firmware never calls this.
router.post(paths('registry'), async (req, res) => {
  try { await adms.machineFor(serialOf(req), { ip: ipOf(req) }); } catch { /* answered below */ }
  return reply(res, 'RegistryCode=none\n');
});

router.all('*', (req, res) => reply(res, 'OK'));

module.exports = router;

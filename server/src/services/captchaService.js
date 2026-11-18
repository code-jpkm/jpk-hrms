const crypto = require('crypto');
const svgCaptcha = require('svg-captcha');
const env = require('../config/env');

/**
 * Built-in picture captcha for the sign-in and forgot-password forms.
 *
 * Nothing is stored per picture: the answer is sealed in a signed token
 * (HMAC of nonce + expiry + answer), so it works on any number of server
 * instances without a database write. Each token can be checked once, right or
 * wrong, so one solved picture cannot be reused to try many passwords.
 * The letters are drawn as SVG paths (not text), so they cannot be read from
 * the page source.
 */
const TTL_MS = 5 * 60 * 1000;
const MAX_TRACKED = 50000;
const used = new Map(); // nonce -> expiry time

function secret() {
  return env.login.captchaSecret || `${env.jwtSecret}:captcha`;
}

function normalise(answer) {
  return String(answer || '').replace(/\s+/g, '').toLowerCase();
}

function sign(nonce, exp, answer) {
  return crypto.createHmac('sha256', secret()).update(`${nonce}.${exp}.${answer}`).digest('base64url');
}

function sweep(now) {
  if (used.size < 1000 && Math.random() > 0.05) return;
  for (const [nonce, exp] of used) if (exp < now) used.delete(nonce);
}

// Letters in dark brand-friendly colours (readable for people), noise lines in
// softer tones that still cross every letter (hard for scripts).
const LETTER_COLOURS = ['#1F3445', '#B85C10', '#3D3D41', '#2C4459', '#8A4A0C', '#2E5B3F', '#4B3A6B'];
const NOISE_COLOURS = ['#8C9DAB', '#F8B57D', '#A2A1A6', '#5D7284', '#C3CDD6'];
const pick = (list) => list[crypto.randomInt(list.length)];

function recolour(svg) {
  return svg
    .replace(/<path fill="#[0-9a-fA-F]{3,8}"/g, () => `<path fill="${pick(LETTER_COLOURS)}"`)
    .replace(/stroke="#[0-9a-fA-F]{3,8}"/g, () => `stroke="${pick(NOISE_COLOURS)}"`);
}

function createCaptcha() {
  const picture = svgCaptcha.create({
    size: 5,
    // No look-alikes: 0/O/o, 1/l/I/i, 5/S/s, 2/Z/z, 9/g/q, u/v, rn/m
    ignoreChars: '0oO1lIi5sS2zZ9gquvVmM',
    noise: 3,
    color: true,
    background: '#f4f6fa',
    width: 170,
    height: 56,
    fontSize: 58
  });
  picture.data = recolour(picture.data);
  const nonce = crypto.randomBytes(12).toString('base64url');
  const exp = Date.now() + TTL_MS;
  return {
    token: `${nonce}.${exp}.${sign(nonce, exp, normalise(picture.text))}`,
    image: `data:image/svg+xml;base64,${Buffer.from(picture.data).toString('base64')}`,
    expiresInSeconds: TTL_MS / 1000
  };
}

/** True when `answer` matches the picture behind `token`. Uses the token up. */
function verifyCaptcha(token, answer) {
  const [nonce, expRaw, signature] = String(token || '').split('.');
  const exp = Number(expRaw);
  const now = Date.now();
  if (!nonce || !signature || !Number.isFinite(exp) || exp < now || exp > now + TTL_MS + 60000) return false;
  sweep(now);
  if (used.has(nonce)) return false;
  if (used.size >= MAX_TRACKED) for (const [key, value] of used) if (value < now) used.delete(key);
  used.set(nonce, exp);
  const expected = Buffer.from(sign(nonce, exp, normalise(answer)));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

module.exports = { createCaptcha, verifyCaptcha, normalise, sign, TTL_MS };

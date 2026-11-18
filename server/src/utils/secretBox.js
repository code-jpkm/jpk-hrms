/**
 * Small authenticated-encryption helper for credentials that HR admins type
 * into Company Settings → Integrations (SMTP passwords, API keys, WhatsApp
 * tokens). Values are stored as `v1:<iv>:<tag>:<ciphertext>` (base64url).
 *
 * The key comes from INTEGRATIONS_SECRET, falling back to JWT_SECRET so an
 * existing deployment works without a new variable. If that secret changes,
 * stored credentials can no longer be decrypted; `open()` then returns '' and
 * the settings screen asks the admin to enter them again.
 */
const crypto = require('crypto');

function key() {
  const material = process.env.INTEGRATIONS_SECRET || process.env.JWT_SECRET || 'dev_secret_change_me';
  return crypto.createHash('sha256').update(`hrms-integrations:${material}`).digest();
}

function seal(plain) {
  if (plain === undefined || plain === null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join(':');
}

function open(sealed) {
  if (!sealed || typeof sealed !== 'string' || !sealed.startsWith('v1:')) return '';
  try {
    const [, iv, tag, data] = sealed.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

/** "sk-live-abcdef1234" → "••••••1234". Never returns the secret itself. */
function mask(plain) {
  const s = String(plain || '');
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return `••••••${s.slice(-4)}`;
}

module.exports = { seal, open, mask };

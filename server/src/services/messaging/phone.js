/**
 * WhatsApp providers need the full international number without "+",
 * e.g. 919830012345. Employee records in this HRMS usually hold Indian
 * 10-digit mobiles ("98300 12345", "098300-12345", "+91 98300 12345"),
 * which WhatsApp rejects or delivers to the wrong country when sent as-is.
 */
function normalizeWhatsappNumber(raw, defaultCountryCode = '91') {
  if (raw === undefined || raw === null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  // Maytapi-style chat ids are already complete.
  if (/@c\.us$|@g\.us$/.test(s)) return s;
  const hadPlus = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  const cc = String(defaultCountryCode || '91').replace(/\D/g, '') || '91';

  if (hadPlus) return digits.length >= 8 && digits.length <= 15 ? digits : '';
  if (cc === '91') {
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
    if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return digits;
    return '';
  }
  if (digits.startsWith(cc) && digits.length > cc.length + 6) return digits.length <= 15 ? digits : '';
  if (digits.startsWith('0')) digits = digits.slice(1);
  const full = `${cc}${digits}`;
  return full.length >= 8 && full.length <= 15 ? full : '';
}

function maskNumber(n) {
  const s = String(n || '');
  return s.length > 4 ? `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : s;
}

module.exports = { normalizeWhatsappNumber, maskNumber };

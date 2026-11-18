/**
 * Branded, email-client-safe HTML (tables + inline styles: Outlook and Gmail
 * ignore <style> blocks and flexbox). One layout for every HR notification so
 * all mail from the HRMS looks like it comes from the same company.
 */

const INK = '#1F3445';
const COBALT = '#1F3445';
const MOLTEN = '#F38121';
const TEXT = '#3D3D41';
const MUTED = '#6A6A6F';
const LINE = '#E1E1E4';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${TEXT};">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function toneBar(tone) {
  if (tone === 'positive') return '#1F3445';
  if (tone === 'negative') return '#C4620E';
  if (tone === 'celebration') return MOLTEN;
  return COBALT;
}

/**
 * @param {object} p
 * @param {string} p.company       Company display name
 * @param {string} p.heading
 * @param {string} p.intro         Plain text; blank lines become paragraphs
 * @param {Array<[string,string]>} p.rows  Key/value facts
 * @param {{label:string,url:string}|null} p.cta
 * @param {string} p.preheader     Inbox preview text
 * @param {string} p.tone          positive | negative | celebration | neutral
 * @param {string} p.footerNote
 */
function renderEmail({ company = 'JPK HRMS', heading, intro, rows = [], cta, preheader = '', tone = 'neutral', footerNote = '', logoUrl = '' }) {
  const factRows = rows
    .filter((r) => Array.isArray(r) && r[1] !== undefined && r[1] !== null && String(r[1]) !== '')
    .map(([k, v]) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:13px;color:${MUTED};width:38%;vertical-align:top;">${esc(k)}</td>
        <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${TEXT};font-weight:600;vertical-align:top;">${esc(v)}</td>
      </tr>`)
    .join('');

  const button = cta && cta.url ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 6px;">
      <tr><td style="border-radius:8px;background:${COBALT};">
        <a href="${esc(cta.url)}" target="_blank" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(cta.label || 'Open')}</a>
      </td></tr>
    </table>
    <p style="margin:6px 0 0;font-size:12px;color:${MUTED};">Or open this link: <a href="${esc(cta.url)}" style="color:${COBALT};word-break:break-all;">${esc(cta.url)}</a></p>` : '';

  const brand = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(company)}" height="28" style="display:block;height:28px;border:0;">`
    : `<span style="font-size:16px;font-weight:700;letter-spacing:.2px;color:#ffffff;">${esc(company)}</span>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#F2F4F8;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader || intro || heading)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F4F8;">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${LINE};">
        <tr><td style="background:${INK};padding:18px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td>${brand}</td>
            <td align="right" style="font-size:12px;color:#AFC0DD;">HR notification</td>
          </tr></table>
        </td></tr>
        <tr><td style="height:3px;background:${toneBar(tone)};line-height:3px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:30px 28px 8px;">
          <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:${INK};font-weight:700;">${esc(heading)}</h1>
          ${paragraphs(intro)}
          ${factRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;border-top:1px solid ${LINE};">${factRows}</table>` : ''}
          ${button}
        </td></tr>
        <tr><td style="padding:26px 28px 28px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">${esc(footerNote || `This is an automated message from the ${company} HRMS. Please do not reply to it; contact HR for help.`)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function renderText({ heading, intro, rows = [], cta }) {
  const lines = [heading, '', intro || ''];
  for (const [k, v] of rows) if (v !== undefined && v !== null && String(v) !== '') lines.push(`${k}: ${v}`);
  if (cta?.url) lines.push('', `${cta.label || 'Open'}: ${cta.url}`);
  return lines.join('\n').trim();
}

module.exports = { renderEmail, renderText, esc };

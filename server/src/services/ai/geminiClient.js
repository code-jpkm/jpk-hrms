/**
 * Gemini client used by every AI feature in the HRMS.
 *
 * - Key from Company Settings → Integrations → AI, else GEMINI_API_KEY.
 * - Sends the key in the x-goog-api-key header (not the URL, which ends up
 *   in proxy and error logs).
 * - Model fallback: the configured model, then gemini-flash-latest and current
 *   stable Flash models, so an old pinned id (gemini-2.5-flash was the v25
 *   default) does not take every AI feature down when Google retires it.
 * - Sends store:false unless the admin allows provider-side logging: HR data
 *   (names, salaries, attendance) should not be retained by default.
 * - Does not send temperature/top_p (deprecated for current models) or a
 *   thinking config (its shape differs between model generations); instead it
 *   gives a generous output budget so thinking tokens cannot starve the answer.
 */
const AiUsage = require('../../models/AiUsage');
const { getConfig } = require('../integrationConfigService');

const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

class AiUnavailableError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

function cleanJsonText(text) {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function parseJsonLoose(text) {
  const cleaned = cleanJsonText(text);
  try { return JSON.parse(cleaned); } catch (_) {}
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

async function callModel({ cfg, model, system, contents, json, schema, maxOutputTokens, timeoutMs, includeStore = true, includeSchema = true }) {
  const body = {
    contents,
    generationConfig: {
      maxOutputTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
      ...(json && schema && includeSchema ? { responseJsonSchema: schema } : {})
    }
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (includeStore) body.store = Boolean(cfg.allowProviderStorage);

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { raw }; }
  if (!res.ok) {
    const message = data.error?.message || data.raw || `HTTP ${res.status}`;
    const err = new Error(`Gemini ${res.status}: ${String(message).slice(0, 300)}`);
    err.status = res.status;
    err.providerMessage = String(message);
    throw err;
  }
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  return { text, finishReason: candidate?.finishReason, usage: data.usageMetadata || {}, blocked: data.promptFeedback?.blockReason };
}

/**
 * @returns {Promise<{ok:true,text:string,data:any,model:string}>}
 * @throws {AiUnavailableError} when AI is off / not configured / every model failed
 */
async function generate({ tenantId, userId, feature = 'GENERAL', system, prompt, history = [], json = false, schema, maxOutputTokens = 4096, timeoutMs }) {
  const config = await getConfig(tenantId);
  const cfg = config.ai;
  if (!cfg.enabled) throw new AiUnavailableError('disabled', 'AI is switched off in Company Settings → Integrations.');
  if (!cfg.configured) throw new AiUnavailableError('not_configured', 'Add a Gemini API key in Company Settings → Integrations → AI to use this.');
  if (feature && cfg.features[feature] === false) throw new AiUnavailableError('feature_off', 'This AI feature is switched off in Company Settings → Integrations → AI.');

  const contents = [
    ...history.filter((h) => h && h.text).slice(-10).map((h) => ({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 4000) }] })),
    { role: 'user', parts: [{ text: String(prompt) }] }
  ];
  const models = [...new Set([cfg.model, ...FALLBACK_MODELS].filter(Boolean))];
  const started = Date.now();
  let lastError = null;
  let includeStore = true;
  let includeSchema = true;

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        let out = await callModel({ cfg, model, system, contents, json, schema, maxOutputTokens, timeoutMs: timeoutMs || cfg.timeoutMs, includeStore, includeSchema });
        if (!out.text && out.finishReason === 'MAX_TOKENS') {
          out = await callModel({ cfg, model, system, contents, json, schema, maxOutputTokens: Math.min(maxOutputTokens * 3, 16384), timeoutMs: timeoutMs || cfg.timeoutMs, includeStore, includeSchema });
        }
        if (out.blocked || out.finishReason === 'SAFETY') throw Object.assign(new Error('Gemini declined to answer this request.'), { status: 422, final: true });
        if (!out.text) throw Object.assign(new Error('Gemini returned an empty answer.'), { status: 502 });
        const data = json ? parseJsonLoose(out.text) : undefined;
        if (json && data === null) throw Object.assign(new Error('Gemini returned malformed JSON.'), { status: 502 });
        AiUsage.create({ tenantId, userId, feature, model, ok: true, ms: Date.now() - started, promptTokens: out.usage.promptTokenCount, outputTokens: out.usage.candidatesTokenCount }).catch(() => {});
        return { ok: true, text: out.text, data, model };
      } catch (error) {
        lastError = error;
        const msg = String(error.providerMessage || error.message || '');
        if (error.status === 400 && /store/i.test(msg) && includeStore) { includeStore = false; continue; }
        if (error.status === 400 && /responseJsonSchema|response_json_schema/i.test(msg) && includeSchema) { includeSchema = false; continue; }
        if (error.final || error.status === 401 || error.status === 403) { attempt = 3; models.length = 0; break; }
        if (error.status === 404 || (error.status === 400 && /not found|not supported|unsupported model/i.test(msg))) break; // try next model
        if (error.status === 429 || error.status === 500 || error.status === 503 || error.name === 'TimeoutError' || error.status === 502) {
          if (attempt < 1) { await new Promise((r) => setTimeout(r, 1200)); continue; }
          break;
        }
        break;
      }
    }
  }
  const message = lastError?.status === 403 || lastError?.status === 401
    ? 'Gemini rejected the API key. Check it in Company Settings → Integrations → AI.'
    : lastError?.status === 429
      ? 'Gemini rate limit reached. Try again in a minute.'
      : (lastError?.message || 'Gemini is unavailable right now.');
  AiUsage.create({ tenantId, userId, feature, model: cfg.model, ok: false, ms: Date.now() - started, error: message.slice(0, 300) }).catch(() => {});
  throw new AiUnavailableError('failed', message);
}

async function isAvailable(tenantId, feature) {
  const config = await getConfig(tenantId);
  return Boolean(config.ai.enabled && config.ai.configured && (!feature || config.ai.features[feature] !== false));
}

module.exports = { generate, isAvailable, AiUnavailableError, parseJsonLoose, cleanJsonText };

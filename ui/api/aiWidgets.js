import { post } from './client.js';
import { localGenerate } from '../components/dashboard/widgetTypes.js';

// Ask the backend to turn a prompt into a widget spec. The Gemini key must
// live on the server, so this hits an endpoint (to be added) that proxies it.
// If the endpoint isn't there yet, or errors, we fall back to a local
// generator so the studio still works during development.
//
// Expected backend contract (POST /dashboard/ai-widget):
//   req:  { prompt }
//   res:  { widget: { type, title, size, tint, config } }
export async function generateWidget(prompt, summary = {}) {
  try {
    const res = await post('/dashboard/ai-widget', { prompt });
    const w = res?.widget || res;
    if (w && w.type) {
      return {
        source: 'gemini',
        widget: normalize(w),
      };
    }
    throw new Error('empty');
  } catch (err) {
    return { source: 'local', widget: localGenerate(prompt, summary), note: friendly(err) };
  }
}

function normalize(w) {
  return {
    id: w.id || `w-${Date.now().toString(36)}`,
    type: w.type,
    title: w.title || 'Gemini widget',
    size: ['sm', 'md', 'lg'].includes(w.size) ? w.size : 'md',
    tint: w.tint || 'indigo',
    config: w.config || {},
  };
}

function friendly(err) {
  const msg = String(err?.message || '');
  if (/404/.test(msg)) return 'Gemini endpoint not connected yet — used the built-in generator.';
  return 'Used the built-in generator (Gemini backend unavailable).';
}

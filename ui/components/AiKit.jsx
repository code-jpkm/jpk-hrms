import React, { useEffect, useState } from 'react';
import { Link } from '../lib/router.jsx';
import { api, post } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';
import Icon from './Icon.jsx';

// One /ai/status request per page load, shared by every AI button on screen.
let statusPromise = null;
export function loadAiStatus(force = false) {
  if (!statusPromise || force) statusPromise = api('/ai/status', { toast: false }).catch(() => ({ available: false, configured: false, enabled: false, features: {} }));
  return statusPromise;
}

export function useAiStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    loadAiStatus().then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, []);
  return status;
}

export function GeminiBadge({ used, model, compact = false }) {
  return (
    <span className={`gemini-badge ${used ? 'is-ai' : 'is-rules'}`} title={used ? `Written by ${model || 'Gemini'}` : 'Calculated from HRMS data (Gemini not used)'}>
      <Icon name={used ? 'Sparkles' : 'Gauge'} size={12} />
      {compact ? (used ? 'Gemini' : 'Rules') : used ? `Gemini${model ? ` · ${model}` : ''}` : 'Rule-based summary'}
    </span>
  );
}

/** Small "connect Gemini" hint; admins get a link to Integrations. */
export function AiSetupHint({ status }) {
  const { user } = useAuth();
  if (!status || status.available) return null;
  const admin = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);
  return (
    <p className="ai-setup-hint">
      <Icon name="Info" size={13} />
      {status.enabled === false ? 'AI is switched off for this company.' : 'Gemini is not connected yet, so this shows a rule-based summary.'}
      {admin && <Link to="/integrations#ai"> Connect Gemini →</Link>}
    </p>
  );
}

function ShimmerLines({ lines = 4 }) {
  return (
    <div className="ai-shimmer" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => <span key={i} style={{ width: `${92 - i * 11}%` }} />)}
    </div>
  );
}

/**
 * A self-contained "Ask Gemini" card. It calls `endpoint` with `body` when the
 * button is pressed (or immediately with autoRun) and hands the JSON to render().
 */
export function AiCard({ title = 'Gemini insights', subtitle, endpoint, body, render, buttonLabel = 'Generate insights', autoRun = false, className = '', deps = [] }) {
  const status = useAiStatus();
  const [state, setState] = useState({ loading: false, data: null, error: null });

  async function run() {
    setState({ loading: true, data: null, error: null });
    try {
      const data = await post(endpoint, body || {}, { toast: false });
      setState({ loading: false, data, error: null });
    } catch (error) {
      setState({ loading: false, data: null, error });
    }
  }

  useEffect(() => {
    if (autoRun && endpoint) run();
    else setState({ loading: false, data: null, error: null });
  }, [endpoint, autoRun, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className={`ai-card ${className}`.trim()}>
      <header className="ai-card-head">
        <span className="ai-orb"><Icon name="Sparkles" size={16} /></span>
        <div>
          <h3>{title}</h3>
          {subtitle && <small>{subtitle}</small>}
        </div>
        <div className="ai-card-actions">
          {state.data && <GeminiBadge used={state.data.usedAi} model={state.data.model} compact />}
          <button type="button" className="ai-run" onClick={run} disabled={state.loading || !endpoint}>
            <Icon name={state.data ? 'RefreshCw' : 'Wand2'} size={14} />
            {state.loading ? 'Thinking…' : state.data ? 'Refresh' : buttonLabel}
          </button>
        </div>
      </header>
      <div className="ai-card-body">
        {state.loading && <ShimmerLines />}
        {state.error && <p className="ai-error"><Icon name="TriangleAlert" size={14} /> {state.error.message}</p>}
        {!state.loading && !state.error && state.data && render(state.data)}
        {!state.loading && !state.error && !state.data && <p className="ai-idle">Gemini reads the HRMS records you are allowed to see and summarises them. Nothing is changed.</p>}
        {state.data && !state.data.usedAi && <AiSetupHint status={status} />}
      </div>
    </section>
  );
}

/** Inline "✨ Draft with Gemini" button for text fields. onResult receives the JSON. */
export function AiButton({ endpoint, body, onResult, label = 'Draft with Gemini', className = '', disabled = false, small = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run() {
    setBusy(true); setError('');
    try {
      const data = await post(endpoint, typeof body === 'function' ? body() : (body || {}), { toast: false });
      onResult?.(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className={`ai-inline ${className}`.trim()}>
      <button type="button" className={`ai-inline-btn ${small ? 'is-small' : ''}`} onClick={run} disabled={busy || disabled}>
        <Icon name="Sparkles" size={small ? 12 : 14} /> {busy ? 'Working…' : label}
      </button>
      {error && <small className="ai-inline-error">{error}</small>}
    </span>
  );
}

export function BulletList({ items = [], tone = '' }) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  return <ul className={`ai-bullets ${tone}`.trim()}>{list.map((item, i) => <li key={i}>{typeof item === 'string' ? item : item.text || JSON.stringify(item)}</li>)}</ul>;
}

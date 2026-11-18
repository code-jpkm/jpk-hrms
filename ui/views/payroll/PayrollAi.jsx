import React, { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { post } from '../../api/client.js';
import { AiCard, GeminiBadge } from '../../components/AiKit.jsx';

const inr = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;

/** Pre-release check of a payroll month: totals vs last month, outliers, statutory slips. */
export function PayrollReview({ month }) {
  return (
    <AiCard
      title={`Gemini payroll check · ${month}`}
      subtitle="Net-pay swings vs last month, zero/negative pay, heavy LOP, ESI above ceiling, missing slips"
      endpoint="/ai/payroll/review"
      body={{ month }}
      deps={[month]}
      buttonLabel="Review before release"
      render={(res) => {
        const d = res.data || {};
        return (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span className={`v26-dot ${d.readiness === 'Looks ready' ? 'on' : 'warn'}`}>{d.readiness}</span>
              {d.totals && <span className="v26-pill">{d.totals.slips} slips · net {inr(d.totals.net)}{d.totals.previousNet ? ` (last month ${inr(d.totals.previousNet)})` : ''}</span>}
            </div>
            <p className="ai-summary">{d.summary}</p>
            {(d.flags || []).length ? (
              <div style={{ display: 'grid', gap: 6 }}>
                {d.flags.slice(0, 15).map((f, i) => <div key={i} className={`ai-flag ${f.severity}`}><Icon name={f.severity === 'high' ? 'TriangleAlert' : 'Info'} size={13} /><span><b>{f.employee}:</b> {f.issue}</span></div>)}
                {d.flags.length > 15 && <small style={{ color: '#807F84', fontWeight: 700 }}>+ {d.flags.length - 15} more</small>}
              </div>
            ) : <div className="ai-flag low"><Icon name="CircleCheck" size={13} /> No exceptions found.</div>}
          </>
        );
      }}
    />
  );
}

/** "Explain my payslip" in plain language, for the employee (or HR answering a query). */
export function ExplainSlip({ slipId }) {
  const [state, setState] = useState({ open: false, loading: false, data: null, error: '' });
  async function run() {
    if (state.data) { setState((s) => ({ ...s, open: !s.open })); return; }
    setState({ open: true, loading: true, data: null, error: '' });
    try { const r = await post(`/ai/payroll/slips/${slipId}/explain`, {}, { toast: false }); setState({ open: true, loading: false, data: r, error: '' }); } catch (err) { setState({ open: true, loading: false, data: null, error: err.message }); }
  }
  return (
    <>
      <button type="button" onClick={run} disabled={state.loading}><Icon name="Sparkles" size={13} /> {state.loading ? 'Explaining…' : state.open && state.data ? 'Hide explanation' : 'Explain this payslip'}</button>
      {state.open && (
        <div className="leave-ai-box" style={{ flexBasis: '100%', width: '100%', marginTop: 10 }}>
          {state.loading && <div className="ai-shimmer"><span style={{ width: '90%' }} /><span style={{ width: '75%' }} /><span style={{ width: '60%' }} /></div>}
          {state.error && <p className="ai-error"><Icon name="TriangleAlert" size={13} /> {state.error}</p>}
          {state.data && <><GeminiBadge used={state.data.usedAi} model={state.data.model} /><ul className="ai-bullets">{(state.data.data?.bullets || []).map((b, i) => <li key={i}>{b}</li>)}</ul></>}
        </div>
      )}
    </>
  );
}

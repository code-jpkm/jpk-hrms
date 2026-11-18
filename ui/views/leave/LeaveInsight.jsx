import React, { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { post } from '../../api/client.js';
import { GeminiBadge } from '../../components/AiKit.jsx';

/** "Should I approve this?" helper for approvers: balance after approval, team overlap, red flags. */
export default function LeaveInsight({ requestId }) {
  const [state, setState] = useState({ open: false, loading: false, data: null, error: '' });
  async function load() {
    if (state.data) { setState((s) => ({ ...s, open: !s.open })); return; }
    setState({ open: true, loading: true, data: null, error: '' });
    try {
      const res = await post(`/ai/leave/${requestId}/insight`, {}, { toast: false });
      setState({ open: true, loading: false, data: res, error: '' });
    } catch (err) {
      setState({ open: true, loading: false, data: null, error: err.message });
    }
  }
  const d = state.data?.data;
  return (
    <div className="leave-ai">
      <button type="button" className="ai-inline-btn is-small" onClick={load} disabled={state.loading}>
        <Icon name="Sparkles" size={12} /> {state.loading ? 'Checking…' : state.open && state.data ? 'Hide insight' : 'AI insight'}
      </button>
      {state.open && (
        <div className="leave-ai-box">
          {state.loading && <div className="ai-shimmer"><span style={{ width: '90%' }} /><span style={{ width: '70%' }} /></div>}
          {state.error && <p className="ai-error"><Icon name="TriangleAlert" size={13} /> {state.error}</p>}
          {d && <>
            <div className="leave-ai-head">
              <span className={`v26-dot ${d.recommendation === 'Approve' ? 'on' : 'warn'}`}>{d.recommendation === 'Approve' ? 'Looks fine to approve' : 'Review before approving'}</span>
              {d.balanceAfter !== null && d.balanceAfter !== undefined && <span className="v26-pill">Balance after: {d.balanceAfter}</span>}
              <GeminiBadge used={state.data.usedAi} model={state.data.model} compact />
            </div>
            <p className="ai-summary" style={{ fontSize: 13 }}>{d.summary}</p>
            {(d.flags || []).map((f, i) => <div key={i} className={`ai-flag ${f.severity}`}><Icon name={f.severity === 'high' ? 'TriangleAlert' : 'Info'} size={13} /> {f.text}</div>)}
            {d.overlaps?.length > 0 && <small style={{ color: '#807F84', fontWeight: 700 }}>Also off: {d.overlaps.map((o) => `${o.name} (${o.from}${o.to !== o.from ? ` → ${o.to}` : ''}, ${String(o.status).toLowerCase()})`).join(', ')}</small>}
          </>}
        </div>
      )}
    </div>
  );
}

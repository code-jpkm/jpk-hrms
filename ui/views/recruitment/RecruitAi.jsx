import React, { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { post } from '../../api/client.js';
import { GeminiBadge } from '../../components/AiKit.jsx';

/** Screen one applicant against the role, with optional pasted resume text. */
export function ScreenCandidate({ candidate, onClose }) {
  const [resume, setResume] = useState('');
  const [state, setState] = useState({ loading: false, data: null, error: '' });
  const [questions, setQuestions] = useState({ loading: false, list: null, error: '' });
  async function run() {
    setState({ loading: true, data: null, error: '' });
    try { const r = await post(`/ai/recruitment/candidates/${candidate._id}/screen`, { resumeText: resume }, { toast: false }); setState({ loading: false, data: r, error: '' }); } catch (err) { setState({ loading: false, data: null, error: err.message }); }
  }
  async function interview() {
    setQuestions({ loading: true, list: null, error: '' });
    try { const r = await post('/ai/recruitment/interview-questions', { title: candidate.position || candidate.jobProfileId?.title, department: candidate.department, experience: candidate.experience, count: 8 }, { toast: false }); setQuestions({ loading: false, list: r.data?.questions || [], error: '' }); } catch (err) { setQuestions({ loading: false, list: null, error: err.message }); }
  }
  const d = state.data?.data || {};
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="letter-modal wide" onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div><small style={{ fontWeight: 800, letterSpacing: '.1em', color: '#807F84' }}>GEMINI SCREENING</small><h3 style={{ margin: '4px 0 0' }}>{candidate.name} · {candidate.position || candidate.jobProfileId?.title || 'Applicant'}</h3></div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <label className="v26-field">Resume text (optional — paste from the CV for a deeper check)
          <textarea value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Paste the candidate's experience, skills and education" style={{ minHeight: 110, borderRadius: 12, border: '1px solid #E1E1E4', padding: 10 }} />
        </label>
        <div className="v26-actions">
          <button type="button" className="ai-inline-btn" onClick={run} disabled={state.loading}><Icon name="Sparkles" size={14} /> {state.loading ? 'Screening…' : state.data ? 'Screen again' : 'Screen candidate'}</button>
          <button type="button" className="ai-inline-btn" onClick={interview} disabled={questions.loading}><Icon name="ListChecks" size={14} /> {questions.loading ? 'Preparing…' : 'Interview questions'}</button>
          {state.data && <GeminiBadge used={state.data.usedAi} model={state.data.model} />}
        </div>
        {state.error && <p className="ai-error"><Icon name="TriangleAlert" size={13} /> {state.error}</p>}
        {state.loading && <div className="ai-shimmer"><span style={{ width: '90%' }} /><span style={{ width: '70%' }} /><span style={{ width: '80%' }} /></div>}
        {state.data && (
          <div className="leave-ai-box">
            <div className="leave-ai-head">
              {d.score !== undefined && <span className="v26-pill" style={{ fontSize: 13, height: 26 }}>Fit score <b>&nbsp;{d.score}/100</b></span>}
              {d.verdict && <span className={`v26-dot ${/strong/i.test(d.verdict) ? 'on' : /weak/i.test(d.verdict) ? 'bad' : 'warn'}`}>{d.verdict}</span>}
            </div>
            {d.summary && <p className="ai-summary" style={{ fontSize: 13.5 }}>{d.summary}</p>}
            <div className="ai-cols">
              <div><h5>Strengths</h5><ul className="ai-bullets good">{(d.strengths || []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              <div><h5>Gaps / risks</h5><ul className="ai-bullets bad">{(d.gaps || d.risks || []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              <div><h5>Ask in interview</h5><ul className="ai-bullets idea">{(d.questions || d.probe || []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            </div>
          </div>
        )}
        {questions.error && <p className="ai-error"><Icon name="TriangleAlert" size={13} /> {questions.error}</p>}
        {questions.list && <div className="leave-ai-box"><b style={{ fontSize: 13 }}>Interview questions</b><ol className="ai-bullets" style={{ paddingLeft: 20 }}>{questions.list.map((q, i) => <li key={i}>{typeof q === 'string' ? q : `${q.question}${q.lookFor ? ` — look for: ${q.lookFor}` : ''}`}</li>)}</ol></div>}
      </div>
    </div>
  );
}

/** Generates a job description from the opening form and fills it in. */
export function JobDescriptionHelper({ opening, onApply }) {
  const [state, setState] = useState({ loading: false, text: '', error: '', used: null });
  async function run() {
    setState({ loading: true, text: '', error: '', used: null });
    try {
      const r = await post('/ai/recruitment/job-description', { title: opening.title, department: opening.department, location: opening.location, experience: opening.experience, ctc: opening.ctc }, { toast: false });
      setState({ loading: false, text: r.text, error: '', used: r });
      onApply?.(r.text);
    } catch (err) { setState({ loading: false, text: '', error: err.message, used: null }); }
  }
  return (
    <div className="v26-span" style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
      <div className="v26-actions">
        <button type="button" className="ai-inline-btn" onClick={run} disabled={state.loading || !opening.title}><Icon name="Sparkles" size={14} /> {state.loading ? 'Writing…' : 'Write job description with Gemini'}</button>
        {state.used && <GeminiBadge used={state.used.usedAi} model={state.used.model} compact />}
        {state.error && <small className="ai-inline-error">{state.error}</small>}
      </div>
    </div>
  );
}

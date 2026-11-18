import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { post } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';

/**
 * Corner HR chat.
 *
 * Read-only by design. It answers questions from the database through
 * POST /dashboard/assistant, which filters every lookup through the caller's own
 * employee scope. Anything that WRITES stays on the AI Assistant page, where
 * there is a permission check, a dry-run preview and an audit trail — a floating
 * chat bubble is the wrong place to approve leave or change a salary.
 */

const SUGGESTIONS = [
  'Is Aindrila present today?',
  'What was her in time?',
  'Who is absent today in Sales team?',
  'Is tomorrow a holiday?',
  'How many present today?'
];

export default function HrChatBot() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [log, setLog] = useState([
    { who: 'bot', text: 'Ask me naturally about attendance, absences by team, holidays, leave, in/out times and permitted HR information. I read live HRMS data and never change anything from this chat.' }
  ]);
  const logRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes, matching every other overlay in the app.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function ask(question) {
    const q = String(question || '').trim();
    if (!q || busy) return;
    setLog((l) => [...l, { who: 'me', text: q }]);
    setText('');
    setBusy(true);
    try {
      const res = await post('/dashboard/assistant', { question: q }, { toast: false });
      setLog((l) => [...l, { who: 'bot', text: res?.answer || 'I could not work that one out.' }]);
    } catch (err) {
      setLog((l) => [...l, { who: 'err', text: err?.message || 'Could not reach the assistant.' }]);
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <>
      {open && (
        <section className="hrbot-panel" role="dialog" aria-label="HR assistant">
          <header className="hrbot-head">
            <span className="v25-glyph" style={{ width: 34, height: 34 }}><Icon name="Sparkles" size={16} /></span>
            <span>
              <b>HR Assistant</b>
              <small>Gemini-assisted · live HRMS answers · read only</small>
            </span>
            <button onClick={() => setOpen(false)} aria-label="Close assistant"><Icon name="X" size={17} /></button>
          </header>

          <div className="hrbot-log" ref={logRef}>
            {log.map((m, i) => (
              <div key={i} className={`hrbot-msg ${m.who === 'me' ? 'me' : m.who === 'err' ? 'err' : 'bot'}`}>{m.text}</div>
            ))}
            {busy && <div className="hrbot-typing"><i /><i /><i /></div>}
          </div>

          {log.length <= 1 && (
            <div className="hrbot-suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          )}

          <div className="hrbot-form">
            <input
              ref={inputRef}
              value={text}
              placeholder="Ask any HR question…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask(text); }}
            />
            <button className="primary" disabled={busy || !text.trim()} onClick={() => ask(text)}>
              <Icon name="Send" size={15} />
            </button>
          </div>
        </section>
      )}

      <button
        className="hrbot-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close HR assistant' : 'Open HR assistant'}
        aria-expanded={open}
      >
        <Icon name={open ? 'X' : 'MessageCircle'} size={23} />
        {!open && <span className="dot" />}
      </button>
    </>
  );
}

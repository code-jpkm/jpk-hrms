import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { post } from '../api/client.js';
import { useAuth } from '../state/AuthContext.jsx';

/**
 * Corner HR chat.
 *
 * Questions are answered from the database through POST /dashboard/assistant,
 * which filters every lookup through the caller's own employee scope.
 *
 * It also does HR tasks the signed-in person is allowed to do: change a shift
 * (including Mon–Fri / Saturday timings), apply leave (approved at once when
 * they can approve it), approve or reject leave, mark a day present / half day /
 * absent or remove LOP, and correct in / out times. The server checks the
 * person's permissions; without one the chat says to contact the administrator
 * or HR. Nothing is saved until the change card is confirmed.
 */

const SUGGESTIONS = [
  'Is Aindrila present today?',
  'Who is absent today?',
  'Apply 1 day EL for me tomorrow',
  'Change Punit\'s shift Mon–Fri 10:30 am to 6:30 pm and Saturday 10:30 am to 3:30 pm',
  'Mark Sukesh present on 12 Nov'
];

const YES = /^(yes|y|ok|okay|confirm|confirmed|do it|go ahead|sure|haan|ha|ji|yes please|proceed)\.?!?$/i;
const NO = /^(no|n|cancel|stop|don'?t|nope|na|nahi)\.?!?$/i;

export default function HrChatBot() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [log, setLog] = useState([
    { who: 'bot', text: 'Ask me about attendance, absences, holidays, leave and in / out times. I can also do HR tasks you are allowed to do — change a shift, apply or approve leave, mark a day present or remove LOP, correct in / out times. I show you the change first and save it only when you confirm.' }
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

  const openCardIndex = () => {
    for (let i = log.length - 1; i >= 0; i -= 1) if (log[i].action && log[i].state === 'open') return i;
    return -1;
  };

  function setCard(index, state) {
    setLog((l) => l.map((m, i) => (i === index ? { ...m, state } : m)));
  }

  async function confirm(index) {
    const card = log[index];
    if (!card?.action || card.state !== 'open' || busy) return;
    setCard(index, 'working');
    setBusy(true);
    try {
      const res = await post('/dashboard/assistant/confirm', { token: card.action.token }, { toast: false });
      setCard(index, res?.denied ? 'denied' : 'done');
      setLog((l) => [...l, { who: res?.denied ? 'deny' : 'bot', text: res?.answer || 'Done.' }]);
    } catch (err) {
      setCard(index, 'failed');
      setLog((l) => [...l, { who: 'err', text: err?.message || 'Could not save that.' }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function cancel(index) {
    if (log[index]?.state !== 'open') return;
    setCard(index, 'cancelled');
    setLog((l) => [...l, { who: 'bot', text: 'Cancelled. Nothing was changed.' }]);
    inputRef.current?.focus();
  }

  async function ask(question) {
    const q = String(question || '').trim();
    if (!q || busy) return;
    const pending = openCardIndex();
    if (pending > -1 && (YES.test(q) || NO.test(q))) {
      setLog((l) => [...l, { who: 'me', text: q }]);
      setText('');
      if (YES.test(q)) confirm(pending); else cancel(pending);
      return;
    }
    // A new request replaces a change card that was never confirmed.
    if (pending > -1) setCard(pending, 'cancelled');
    setLog((l) => [...l, { who: 'me', text: q }]);
    setText('');
    setBusy(true);
    try {
      const res = await post('/dashboard/assistant', { question: q }, { toast: false });
      if (res?.action) setLog((l) => [...l, { who: 'bot', text: res.answer, action: res.action, state: 'open' }]);
      else setLog((l) => [...l, { who: res?.denied ? 'deny' : 'bot', text: res?.answer || 'I could not work that one out.' }]);
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
              <small>Answers and HR tasks · within your permissions</small>
            </span>
            <button onClick={() => setOpen(false)} aria-label="Close assistant"><Icon name="X" size={17} /></button>
          </header>

          <div className="hrbot-log" ref={logRef}>
            {log.map((m, i) => (m.action ? (
              <ActionCard key={i} message={m} onConfirm={() => confirm(i)} onCancel={() => cancel(i)} />
            ) : (
              <div key={i} className={`hrbot-msg ${m.who === 'me' ? 'me' : m.who === 'err' ? 'err' : m.who === 'deny' ? 'deny' : 'bot'}`}>
                {m.who === 'deny' && <Icon name="Lock" size={14} />}
                <span>{m.text}</span>
              </div>
            )))}
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
              placeholder={openCardIndex() > -1 ? 'Type yes to confirm, or ask something else…' : 'Ask a question or give an HR task…'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask(text); }}
            />
            <button className="primary" disabled={busy || !text.trim()} onClick={() => ask(text)} aria-label="Send">
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

/** The change the chat is about to make: what, for whom, when — and Confirm / Cancel. */
function ActionCard({ message, onConfirm, onCancel }) {
  const { action, state } = message;
  const settled = state !== 'open' && state !== 'working';
  return (
    <div className={`hrbot-act hrbot-act-${state}`} role="group" aria-label={action.title}>
      <div className="hrbot-act-title"><Icon name="ClipboardCheck" size={15} /><b>{action.title}</b></div>
      <dl>
        {action.lines.map((line) => (
          <div key={`${line.label}:${line.value}`}><dt>{line.label}</dt><dd>{line.value}</dd></div>
        ))}
      </dl>
      {action.note && <p className="hrbot-act-note">{action.note}</p>}
      {!settled ? (
        <div className="hrbot-act-buttons">
          <button type="button" className="primary" onClick={onConfirm} disabled={state === 'working'}>
            {state === 'working' ? <><Icon name="Loader2" size={14} className="spin" /> Saving…</> : <><Icon name="Check" size={14} /> {action.confirmLabel}</>}
          </button>
          <button type="button" className="secondary" onClick={onCancel} disabled={state === 'working'}>Cancel</button>
        </div>
      ) : (
        <div className="hrbot-act-state">
          {state === 'done' && <><Icon name="CheckCircle2" size={14} /> Saved</>}
          {state === 'cancelled' && <><Icon name="CircleX" size={14} /> Not saved</>}
          {state === 'denied' && <><Icon name="Lock" size={14} /> Not allowed</>}
          {state === 'failed' && <><Icon name="TriangleAlert" size={14} /> Not saved</>}
        </div>
      )}
    </div>
  );
}

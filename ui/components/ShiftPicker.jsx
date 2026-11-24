import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { searchShifts, shiftDetails, recentShiftIds, rememberShift, queryWords } from '../utils/shiftSearch.js';
import '../styles/pickers.css';

/** Bold the parts of the name the person typed. */
function Marked({ text, words }) {
  const plain = String(text || '');
  const parts = words.filter((w) => w.length > 0 && !/^\d/.test(w));
  if (!parts.length) return plain;
  const re = new RegExp(`(${parts.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return plain.split(re).map((piece, i) => (i % 2 ? <mark key={i}>{piece}</mark> : <React.Fragment key={i}>{piece}</React.Fragment>));
}

/**
 * Shift chooser for long lists: type a name, code, time ("9:30", "8-5") or day
 * ("sat off"); ↑ ↓ to move, Enter to pick, Esc to close. Recently picked shifts
 * come first. Works with the mouse too.
 */
export default function ShiftPicker({
  shifts = [],
  value = '',
  onChange,
  currentId = '',
  loading = false,
  disabled = false,
  autoFocus = false,
  placeholder = 'Type a shift name, code or time',
  labelledBy,
  id,
}) {
  const ownId = useId();
  const inputId = id || `shift-picker-${ownId}`;
  const listId = `${inputId}-list`;
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState(() => recentShiftIds());

  const selected = shifts.find((s) => s._id === value) || null;
  const words = queryWords(query);

  // What the list shows: with no query, recently picked shifts first, then all.
  const rows = useMemo(() => {
    const found = searchShifts(shifts, query);
    if (queryWords(query).length) return found.map((shift) => ({ shift, group: null }));
    const recentShifts = recent.map((rid) => shifts.find((s) => s._id === rid)).filter(Boolean);
    const rest = found.filter((s) => !recentShifts.includes(s));
    return [
      ...recentShifts.map((shift, i) => ({ shift, group: i === 0 ? 'Recently picked' : null })),
      ...rest.map((shift, i) => ({ shift, group: i === 0 && recentShifts.length ? 'All shifts' : null })),
    ];
  }, [shifts, query, recent]);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  // Keep the highlighted row in view while moving with the keys.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function openList(startQuery = '') {
    setRecent(recentShiftIds()); // another part of the page may have picked one
    setQuery(startQuery);
    setActive(-1); // set below, once the rows are rebuilt
    setOpen(true);
  }

  // On opening, highlight the chosen shift (or the first row while typing).
  useEffect(() => {
    if (!open || active !== -1) return;
    const at = query ? 0 : rows.findIndex((r) => r.shift._id === value);
    setActive(at >= 0 ? at : 0);
  }, [open, active, rows, query, value]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function choose(shift) {
    if (!shift) return;
    rememberShift(shift._id);
    setRecent(recentShiftIds());
    onChange?.(shift._id, shift);
    close();
  }

  function onKeyDown(e) {
    const last = rows.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList(query);
        else setActive((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList(query);
        else setActive((i) => Math.max(0, i - 1));
        break;
      case 'PageDown':
        if (open) { e.preventDefault(); setActive((i) => Math.min(last, i + 8)); }
        break;
      case 'PageUp':
        if (open) { e.preventDefault(); setActive((i) => Math.max(0, i - 8)); }
        break;
      case 'Enter':
        // Never sends the form from here: Enter picks (or opens the list).
        e.preventDefault();
        if (open && rows[active]) choose(rows[active].shift);
        else if (!open) openList(query);
        break;
      case 'Escape':
        if (open) { e.preventDefault(); e.stopPropagation(); close(); }
        break;
      case 'Tab':
        if (open && query && rows[active]) choose(rows[active].shift);
        else if (open) close();
        break;
      default:
    }
  }

  return (
    <div className="sp" ref={wrapRef} onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget)) close(); }}>
      <div className={`sp-box${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}>
        <Icon name="Search" size={15} />
        <input
          ref={inputRef}
          id={inputId}
          className="sp-input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
          aria-labelledby={labelledBy}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={open ? query : selected ? `${selected.name}` : ''}
          placeholder={loading ? 'Loading shifts…' : selected && open ? selected.name : placeholder}
          onFocus={() => { if (!open) openList(''); }}
          onClick={() => { if (!open) openList(''); }}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        {!open && selected && <small className="sp-when">{shiftDetails(selected)}</small>}
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={15} />
      </div>
      {open && (
        <div className="sp-pop">
          <ul className="sp-list" id={listId} role="listbox" ref={listRef} aria-label="Shifts">
            {loading && !shifts.length && <li className="sp-empty">Loading shifts…</li>}
            {!loading && !rows.length && <li className="sp-empty">No shift matches “{query}”. Try a code (F12), a time (9:30, 8-5) or a day (sat off).</li>}
            {rows.map(({ shift, group }, i) => (
              <React.Fragment key={shift._id}>
                {group && <li className="sp-group" role="presentation">{group}</li>}
                <li
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={shift._id === value}
                  className={`sp-option${i === active ? ' is-active' : ''}${shift._id === value ? ' is-chosen' : ''}`}
                  onMouseDown={(e) => e.preventDefault() /* keep the typing box focused */}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); choose(shift); }}
                  onMouseMove={() => { if (i !== active) setActive(i); }}
                >
                  <div className="sp-option-name">
                    <b><Marked text={shift.name} words={words} /></b>
                    {shift.code && !String(shift.name || '').toLowerCase().startsWith(String(shift.code).toLowerCase()) && <span className="sp-chip">{shift.code}</span>}
                    {shift._id === currentId && <span className="sp-chip is-now">Now</span>}
                    {shift._id === value && <Icon name="Check" size={15} />}
                  </div>
                  <small>{shiftDetails(shift)}</small>
                </li>
              </React.Fragment>
            ))}
          </ul>
          <div className="sp-foot" aria-hidden="true">
            <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
            <span><kbd>Enter</kbd> pick</span>
            <span><kbd>Esc</kbd> close</span>
            <em>{words.length ? `${rows.length} of ${shifts.length}` : `${shifts.length} shifts`}</em>
          </div>
        </div>
      )}
    </div>
  );
}

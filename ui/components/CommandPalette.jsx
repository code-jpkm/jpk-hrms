import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '../lib/router.jsx';
import Icon from './Icon.jsx';
import { api } from '../api/client.js';
import { NAV_ITEMS, QUICK_ACTIONS, canOpenNavItem, canUseQuickAction, navLabel } from '../utils/nav.js';
import { canAccessPath } from '../utils/permissions.js';
import { prefetchRoute } from '../utils/routePrefetch.js';

const fullName = (e) => `${e.firstName || ''} ${e.lastName || ''}`.trim();

/**
 * One search box for everything: people (for anyone who can open the
 * employee list), pages and common actions. Plain words, no jargon.
 */
export default function CommandPalette({ user, onClose, onOpenAi }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [people, setPeople] = useState([]);
  const inputRef = useRef(null);
  const canSearchPeople = canAccessPath(user, '/employees');

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!canSearchPeople) return undefined;
    let alive = true;
    api('/employees', { toast: false }).then((r) => { if (alive) setPeople(r.employees || []); }).catch(() => {});
    return () => { alive = false; };
  }, [canSearchPeople]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pages = NAV_ITEMS
      .filter((i) => canOpenNavItem(user, i))
      .map((i) => ({ kind: 'Page', id: i.to, label: navLabel(i, user), sub: i.group || 'Menu', icon: i.icon, to: i.to }));
    const actions = QUICK_ACTIONS
      .filter((a) => canUseQuickAction(user, a))
      .map((a) => ({ kind: 'Action', id: a.id, label: a.label, sub: 'Do this now', icon: a.icon, to: a.to }));
    const ai = onOpenAi ? [{ kind: 'AI', id: 'ai', label: 'Create a dashboard card with Gemini', sub: 'AI', icon: 'Sparkles' }] : [];
    if (!term) return [...actions.slice(0, 5), ...pages.slice(0, 6)];

    const match = (text) => {
      const t = text.toLowerCase();
      if (t === term) return 0;
      if (t.startsWith(term)) return 1;
      if (t.split(/\s+/).some((w) => w.startsWith(term))) return 2;
      if (t.includes(term)) return 3;
      return 99;
    };
    const personRows = people
      .map((e) => {
        const name = fullName(e);
        const score = Math.min(match(name), match(String(e.employeeCode || '')), match(String(e.department || '')) + 1);
        return { kind: 'Person', id: e._id, label: name || e.employeeCode, sub: [e.employeeCode, e.designation, e.department].filter(Boolean).join(' · '), icon: 'UserRound', to: `/employees?id=${e._id}`, score };
      })
      .filter((r) => r.score < 99)
      .sort((a, b) => a.score - b.score)
      .slice(0, 6);
    const rest = [...actions, ...pages, ...ai]
      .map((r) => ({ ...r, score: Math.min(match(r.label), match(r.sub) + 2) }))
      .filter((r) => r.score < 99)
      .sort((a, b) => a.score - b.score)
      .slice(0, 8);
    return [...personRows, ...rest];
  }, [q, user, people, onOpenAi]);

  useEffect(() => { setActive(0); }, [q]);

  function choose(r) {
    if (!r) return;
    onClose();
    if (r.kind === 'AI') { onOpenAi?.(); return; }
    navigate(r.to);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') { onClose(); }
  }

  let lastKind = '';
  const heading = { Person: 'People', Action: 'Actions', Page: 'Pages', AI: 'AI' };

  return (
    <div className="jpk-search-backdrop" onClick={onClose}>
      <div className="jpk-search-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="jpk-search-input">
          <Icon name="Search" size={18} />
          <input
            ref={inputRef}
            placeholder={canSearchPeople ? 'Type a name, employee code or page…' : 'Type a page or action…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search"
          />
          <button type="button" className="jpk-search-close" onClick={onClose} aria-label="Close search">Esc</button>
        </div>
        <div className="jpk-search-results">
          {results.length === 0 && <p className="jpk-search-empty">Nothing found for “{q}”. Try a first name or employee code.</p>}
          {results.map((r, i) => {
            const showHeading = r.kind !== lastKind;
            lastKind = r.kind;
            return (
              <React.Fragment key={`${r.kind}-${r.id}`}>
                {showHeading && <div className="jpk-search-heading">{!q && r.kind === 'Action' ? 'Quick actions' : heading[r.kind]}</div>}
                <button
                  type="button"
                  className={`jpk-search-row ${i === active ? 'active' : ''}`}
                  onMouseEnter={() => { setActive(i); if (r.to) prefetchRoute(r.to.split('?')[0]); }}
                  onClick={() => choose(r)}
                >
                  <span className={`jpk-search-glyph ${r.kind === 'Person' ? 'person' : ''}`}>{r.kind === 'Person' ? (r.label || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() : <Icon name={r.icon} size={16} />}</span>
                  <span className="jpk-search-text"><b>{r.label}</b>{r.sub && <small>{r.sub}</small>}</span>
                  <Icon name="CornerDownLeft" size={14} />
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="jpk-search-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span></div>
      </div>
    </div>
  );
}

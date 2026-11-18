import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from '../lib/router.jsx';
import Icon from './Icon.jsx';
import { launcherGroups, navHint, navLabel } from '../utils/nav.js';
import { prefetchRoute } from '../utils/routePrefetch.js';

/**
 * The 9-dot menu: every module this person can open, grouped, each with a
 * one-line hint so a first-time user knows what it is for.
 */
export default function AppLauncher({ user, onClose }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [q, setQ] = useState('');
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return launcherGroups(user)
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => !term || `${navLabel(i, user)} ${navHint(i, user)}`.toLowerCase().includes(term)),
      }))
      .filter((g) => g.items.length);
  }, [user, q]);

  function go(to) {
    onClose();
    navigate(to);
  }

  function onSearchKey(e) {
    if (e.key === 'Enter') {
      const first = groups[0]?.items[0];
      if (first) go(first.to);
    }
  }

  return (
    <div className="jpk-launcher-backdrop" onMouseDown={onClose}>
      <div className="jpk-launcher" ref={panelRef} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="All modules">
        <div className="jpk-launcher-head">
          <div className="jpk-launcher-search">
            <Icon name="Search" size={16} />
            <input autoFocus placeholder="Find a module, e.g. leave" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} aria-label="Find a module" />
          </div>
          <button type="button" className="jpk-top-icon" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        <div className="jpk-launcher-body">
          {groups.length === 0 && <p className="jpk-launcher-empty">Nothing matches “{q}”. Try another word.</p>}
          {groups.map((g) => (
            <section key={g.title} className="jpk-launcher-group">
              <h3>{g.title}</h3>
              <div className="jpk-launcher-grid">
                {g.items.map((i) => (
                  <button
                    key={i.to}
                    type="button"
                    className={`jpk-launcher-tile ${pathname === i.to ? 'current' : ''}`}
                    onMouseEnter={() => prefetchRoute(i.to)}
                    onFocus={() => prefetchRoute(i.to)}
                    onClick={() => go(i.to)}
                  >
                    <span className="jpk-launcher-icon"><Icon name={i.icon} size={18} /></span>
                    <span className="jpk-launcher-text">
                      <b>{navLabel(i, user)}</b>
                      {navHint(i, user) && <small>{navHint(i, user)}</small>}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

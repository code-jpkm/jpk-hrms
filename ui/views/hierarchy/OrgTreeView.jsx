import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Link } from '../../lib/router.jsx';
import { layoutOrgChart, ORG_CHART_SIZES, personInitials, personName } from '../../utils/orgChartLayout.mjs';

/**
 * The organisation chart as a tree: cards joined by lines, top down.
 * Drag to move around, pinch / Ctrl + scroll (or the buttons) to zoom, the
 * button under a card to open or close that person's team. Clicking a card
 * offers their profile and "show only this team".
 */

const MIN_ZOOM = 0.04;
const MAX_ZOOM = 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function OrgTreeView({ roots, collapsed, onToggle, colourOf, highlight, focusId, onFocus, separateUnplaced }) {
  const sizes = ORG_CHART_SIZES.screen;
  const layout = useMemo(
    () => layoutOrgChart(roots, { ...sizes, separateUnplaced, isCollapsed: (id) => Boolean(collapsed[id]) }),
    [roots, collapsed, separateUnplaced, sizes]
  );
  const boxById = useMemo(() => new Map(layout.boxes.map((b) => [b.id, b])), [layout]);
  const shellRef = useRef(null);
  const viewportRef = useRef(null);
  const [view, setView] = useState(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [selectedId, setSelectedId] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const anchorRef = useRef(null);
  const centredRef = useRef(0);
  const gesture = useRef({ pointers: new Map(), pan: null, pinch: null, moved: false });

  const fitView = useCallback((mode = 'fit') => {
    const el = viewportRef.current;
    if (!el || !layout.boxes.length) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const pad = 36;
    const fitK = clamp(Math.min((vw - 2 * pad) / layout.width, (vh - 2 * pad) / layout.height), MIN_ZOOM, 1);
    if (mode === 'fit' || fitK >= 0.5) {
      setView({ k: fitK, x: (vw - layout.width * fitK) / 2, y: Math.max(pad, (vh - layout.height * fitK) / 2) });
      return;
    }
    // Too big to read when it all fits: start at a readable size on the top of the chart.
    const k = 0.75;
    const top = layout.boxes.reduce((best, b) => (b.depth === 0 && (!best || b.y < best.y) ? b : best), null) || layout.boxes[0];
    setView({ k, x: vw / 2 - (top.x + top.w / 2) * k, y: pad });
  }, [layout]);

  // First view, and a fresh one whenever a different team is shown.
  const fittedFor = useRef(null);
  useLayoutEffect(() => {
    const key = `${focusId || 'all'}`;
    if (fittedFor.current === key && viewRef.current) return;
    fittedFor.current = key;
    fitView('start');
  }, [focusId, fitView]);

  // Opening or closing a team keeps that card where it was on the screen.
  useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    anchorRef.current = null;
    const box = boxById.get(a.id);
    const v = viewRef.current;
    if (!box || !v) return;
    setView({ ...v, x: v.x + (a.sx - (box.x * v.k + v.x)), y: v.y + (a.sy - (box.y * v.k + v.y)) });
  }, [boxById]);

  // A person picked in the search: bring their card to the middle.
  useEffect(() => {
    if (!highlight?.id || centredRef.current === highlight.at) return;
    const box = boxById.get(highlight.id);
    const el = viewportRef.current;
    if (!box || !el) return;
    centredRef.current = highlight.at;
    const k = Math.max(viewRef.current?.k || 1, 0.9);
    setView({ k, x: el.clientWidth / 2 - (box.x + box.w / 2) * k, y: el.clientHeight / 2 - (box.y + box.h / 2) * k });
    setSelectedId(highlight.id);
  }, [highlight, boxById]);

  // Pinch / Ctrl + scroll zooms; a sideways swipe moves along. Plain scrolling still scrolls the page.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const v = viewRef.current;
      if (!v) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.0025), MIN_ZOOM, MAX_ZOOM);
        setView({ k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) });
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        setView({ ...v, x: v.x - e.deltaX });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement === shellRef.current);
      setTimeout(() => fitView('fit'), 60);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [fitView]);

  function zoomBy(factor) {
    const el = viewportRef.current;
    const v = viewRef.current;
    if (!el || !v) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
    setView({ k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) });
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else shellRef.current?.requestFullscreen?.().catch(() => {});
  }

  const toggle = useCallback((id) => {
    const box = boxById.get(id);
    const v = viewRef.current;
    if (box && v) anchorRef.current = { id, sx: box.x * v.k + v.x, sy: box.y * v.k + v.y };
    onToggle(id);
  }, [boxById, onToggle]);

  // Drag anywhere (cards too) to move; two fingers to zoom. A drag is not a click.
  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('button, a, input, select, .org-selbar, .org-zoom')) return;
    const g = gesture.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // No pointer capture yet: a plain click must still reach the card under it.
    if (g.pointers.size === 1) {
      g.pan = { sx: e.clientX, sy: e.clientY, v: viewRef.current };
      g.moved = false;
    } else if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      const r = viewportRef.current.getBoundingClientRect();
      g.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, v: viewRef.current };
      g.pan = null;
      g.moved = true;
      for (const id of g.pointers.keys()) { try { viewportRef.current.setPointerCapture(id); } catch (_) { /* pointer already gone */ } }
    }
  }
  function onPointerMove(e) {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pinch && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const r = viewportRef.current.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      const { v } = g.pinch;
      const k = clamp(v.k * (d / g.pinch.d), MIN_ZOOM, MAX_ZOOM);
      setView({ k, x: mx - (g.pinch.mx - v.x) * (k / v.k), y: my - (g.pinch.my - v.y) * (k / v.k) });
      return;
    }
    if (!g.pan?.v) return;
    const dx = e.clientX - g.pan.sx;
    const dy = e.clientY - g.pan.sy;
    if (!g.moved && Math.hypot(dx, dy) < 5) return;
    if (!g.moved) {
      g.moved = true;
      // Now it is a drag: keep it going even if the pointer leaves the chart.
      try { viewportRef.current.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
    }
    setView({ ...g.pan.v, x: g.pan.v.x + dx, y: g.pan.v.y + dy });
  }
  function onPointerUp(e) {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size < 2) g.pinch = null;
    if (!g.pointers.size) g.pan = null;
  }
  // The browser scrolls this box itself to show a card that gets focus (Tab,
  // or a link into view). Turn that into a move of the chart instead.
  function onScroll(e) {
    const el = e.currentTarget;
    const dx = el.scrollLeft;
    const dy = el.scrollTop;
    if (!dx && !dy) return;
    el.scrollLeft = 0;
    el.scrollTop = 0;
    setView((v) => (v ? { ...v, x: v.x - dx, y: v.y - dy } : v));
  }
  function onClickCapture(e) {
    if (gesture.current.moved) {
      e.stopPropagation();
      e.preventDefault();
      gesture.current.moved = false;
    }
  }

  // Tabbing to a card outside the view moves the chart to show it (not on mouse clicks).
  const showCard = useCallback((e, b) => {
    if (!e.target.matches?.(':focus-visible')) return;
    const el = viewportRef.current;
    const v = viewRef.current;
    if (!el || !v) return;
    const pad = 28;
    const sx = b.x * v.k + v.x;
    const sy = b.y * v.k + v.y;
    const ex = sx + b.w * v.k;
    const ey = sy + b.h * v.k;
    let dx = 0;
    let dy = 0;
    if (sx < pad) dx = pad - sx; else if (ex > el.clientWidth - pad) dx = el.clientWidth - pad - ex;
    if (sy < pad) dy = pad - sy; else if (ey > el.clientHeight - pad) dy = el.clientHeight - pad - ey;
    if (dx || dy) setView({ ...v, x: v.x + dx, y: v.y + dy });
  }, []);

  const selected = selectedId ? boxById.get(selectedId) : null;
  const highlightId = highlight?.id || '';

  // The cards and lines only change with the chart, not while moving around.
  const stage = useMemo(() => {
    const path = layout.lines.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('');
    return (
      <>
        <svg className="org-lines" width={layout.width} height={layout.height} aria-hidden="true">
          <path d={path} />
        </svg>
        {layout.section && (
          <div className="org-section-label" style={{ left: layout.section.x, top: layout.section.y, width: layout.section.w }}>{layout.section.label}</div>
        )}
        {layout.boxes.map((b) => {
          const p = b.node;
          const name = personName(p);
          const cls = ['org-card', b.id === selectedId ? 'is-selected' : '', b.id === highlightId ? 'is-match' : ''].filter(Boolean).join(' ');
          return (
            <div
              key={b.id}
              className={cls}
              style={{ left: b.x, top: b.y, width: b.w, height: b.h, '--dept': colourOf(p.department) }}
              role="button"
              tabIndex={0}
              aria-pressed={b.id === selectedId}
              aria-label={`${name}, ${p.designation || 'Employee'}${b.reports ? `, ${b.reports} direct reports` : ''}`}
              onClick={() => setSelectedId((cur) => (cur === b.id ? '' : b.id))}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(b.id); } }}
              onFocus={(e) => showCard(e, b)}
            >
              <span className="org-card-avatar">
                {p.profilePhotoUrl ? <img src={p.profilePhotoUrl} alt="" loading="lazy" draggable={false} /> : personInitials(p)}
              </span>
              <span className="org-card-text">
                <b>{name}</b>
                <span>{p.designation || 'Employee'}</span>
                <small>{[p.department, p.employeeCode].filter(Boolean).join(' · ')}</small>
              </span>
              {b.reports > 0 && (
                <button
                  type="button"
                  className={`org-card-toggle${b.collapsed ? ' is-closed' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggle(b.id); }}
                  onFocus={(e) => { e.stopPropagation(); showCard(e, b); }}
                  aria-expanded={!b.collapsed}
                  aria-label={b.collapsed ? `Show ${name}'s ${b.reports} direct reports` : `Hide ${name}'s team`}
                  title={b.collapsed ? `Show ${b.reports} direct reports` : 'Hide this team'}
                >
                  {b.collapsed ? `+${b.reports}` : <Icon name="ChevronUp" size={13} />}
                </button>
              )}
            </div>
          );
        })}
      </>
    );
  }, [layout, selectedId, highlightId, colourOf, toggle, showCard]);

  const k = view?.k || 1;
  return (
    <div className={`org-canvas-shell${fullscreen ? ' is-fullscreen' : ''}`} ref={shellRef}>
      <div
        className="org-canvas"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        onScroll={onScroll}
        onKeyDown={(e) => { if (e.key === 'Escape') setSelectedId(''); }}
        aria-label="Organisation chart, tree view"
      >
        {!layout.boxes.length ? <p className="org-empty">Nobody to show.</p> : (
          <div className="org-stage" style={view ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: layout.width, height: layout.height } : { visibility: 'hidden', width: layout.width, height: layout.height }}>
            {stage}
          </div>
        )}
      </div>

      <div className="org-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out"><Icon name="Minus" size={15} /></button>
        <span aria-live="polite">{Math.round(k * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in"><Icon name="Plus" size={15} /></button>
        <button type="button" onClick={() => fitView('fit')} title="Fit the whole chart">Fit</button>
        <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Leave full screen' : 'Full screen'} title={fullscreen ? 'Leave full screen' : 'Full screen'}><Icon name={fullscreen ? 'Minimize2' : 'Maximize2'} size={15} /></button>
      </div>
      <p className="org-hint">Drag to move · pinch or Ctrl + scroll to zoom</p>

      {selected && (
        <div className="org-selbar" role="dialog" aria-label={`${personName(selected.node)} selected`}>
          <span className="org-selbar-who">
            <b>{personName(selected.node)}</b>
            <small>{selected.node.designation || 'Employee'}{selected.reports ? ` · ${selected.reports} direct report${selected.reports === 1 ? '' : 's'}` : ''}</small>
          </span>
          <Link className="org-selbar-btn" to={`/employees?id=${selected.id}`}><Icon name="UserRound" size={14} /> Profile</Link>
          {selected.reports > 0 && focusId !== selected.id && (
            <button type="button" className="org-selbar-btn" onClick={() => { onFocus(selected.id); setSelectedId(''); }}><Icon name="Network" size={14} /> Only this team</button>
          )}
          <button type="button" className="org-selbar-close" onClick={() => setSelectedId('')} aria-label="Close"><Icon name="X" size={14} /></button>
        </div>
      )}
    </div>
  );
}

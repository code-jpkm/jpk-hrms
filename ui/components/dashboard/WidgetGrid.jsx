import React, { useState } from 'react';
import { Link } from '../../lib/router.jsx';
import Icon from '../Icon.jsx';
import { CATALOG, blankWidget, resolveValue, resolveSeries } from './widgetTypes.js';
import { usableQuickActions } from '../../utils/nav.js';
import { useAuth } from '../../state/AuthContext.jsx';

const SIZE_NEXT = { sm: 'md', md: 'lg', lg: 'sm' };

export default function WidgetGrid({ widgets, editing, summary = {}, onAdd, onRemove, onUpdate, onMove }) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  return (
    <div className="widget-grid">
      {widgets.map((w) => (
        <div
          key={w.id}
          className={`widget size-${w.size} tint-${w.tint} ${editing ? 'is-editing' : ''} ${overId === w.id ? 'is-over' : ''} ${dragId === w.id ? 'is-dragging' : ''}`}
          draggable={editing}
          onDragStart={(e) => { setDragId(w.id); e.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={(e) => { if (editing && dragId) { e.preventDefault(); setOverId(w.id); } }}
          onDragLeave={() => setOverId((o) => (o === w.id ? null : o))}
          onDrop={(e) => { e.preventDefault(); if (dragId) onMove(dragId, w.id); setDragId(null); setOverId(null); }}
          onDragEnd={() => { setDragId(null); setOverId(null); }}
        >
          {editing && (
            <div className="widget-toolbar">
              <span className="drag-handle" title="Drag to reorder"><Icon name="GripVertical" size={15} /></span>
              <button className="mini-icon" title="Resize" onClick={() => onUpdate(w.id, { size: SIZE_NEXT[w.size] })}><Icon name="Maximize2" size={13} /></button>
              <button className="mini-icon danger" title="Remove" onClick={() => onRemove(w.id)}><Icon name="Trash2" size={13} /></button>
            </div>
          )}
          <WidgetHeader w={w} editing={editing} onUpdate={onUpdate} />
          <WidgetBody w={w} editing={editing} onUpdate={onUpdate} summary={summary} />
        </div>
      ))}

      {editing && <AddWidgetTile onAdd={onAdd} />}
    </div>
  );
}

function WidgetHeader({ w, editing, onUpdate }) {
  if (w.type === 'metric') return null; // metric shows its own big number
  return (
    <div className="widget-head">
      {editing ? (
        <input className="title-input" value={w.title} onChange={(e) => onUpdate(w.id, { title: e.target.value })} />
      ) : (
        <h3>{w.title}</h3>
      )}
    </div>
  );
}

function WidgetBody({ w, editing, onUpdate, summary }) {
  switch (w.type) {
    case 'metric': return <MetricBody w={w} editing={editing} onUpdate={onUpdate} summary={summary} />;
    case 'chart': return <ChartBody w={w} summary={summary} />;
    case 'list': return <ListBody w={w} />;
    case 'progress': return <ProgressBody w={w} />;
    case 'quickActions': return <QuickActionsBody w={w} />;
    case 'note': return <NoteBody w={w} editing={editing} onUpdate={onUpdate} />;
    case 'link': return <LinkBody w={w} />;
    default: return <p className="widget-muted">Unknown widget.</p>;
  }
}

function MetricBody({ w, editing, onUpdate, summary }) {
  const c = w.config || {};
  const value = resolveValue(c, summary);
  return (
    <div className="metric-body">
      <span className="metric-glyph"><Icon name={c.icon || 'Gauge'} size={20} /></span>
      <div className="metric-figures">
        {editing ? (
          <input className="metric-value-input" value={value} onChange={(e) => onUpdate(w.id, { config: { value: e.target.value, bind: null } })} />
        ) : (
          <strong>{value ?? 0}</strong>
        )}
        <span className="metric-label">{c.label}</span>
        {c.helper && <small>{c.helper}</small>}
      </div>
    </div>
  );
}

function ChartBody({ w, summary }) {
  const c = w.config || {};
  const series = resolveSeries(c, summary);
  const max = Math.max(1, ...series.map((s) => Number(s.value) || 0));
  if (c.kind === 'line') return <LineChart series={series} max={max} />;
  return (
    <div className="bar-chart">
      {series.map((s, i) => (
        <div className="bar-col" key={i}>
          <div className="bar-track"><span className="bar-fill" style={{ height: `${(Number(s.value) / max) * 100}%` }} /></div>
          <b>{s.value}</b>
          <small>{s.label}</small>
        </div>
      ))}
    </div>
  );
}

function LineChart({ series, max }) {
  const w = 300, h = 120, pad = 10;
  const step = series.length > 1 ? (w - pad * 2) / (series.length - 1) : 0;
  const pts = series.map((s, i) => {
    const x = pad + i * step;
    const y = h - pad - (Number(s.value) / max) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pad + (series.length - 1) * step},${h - pad} L${pad},${h - pad} Z`;
  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <path className="line-area" d={area} />
        <path className="line-stroke" d={line} />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" className="line-dot" />)}
      </svg>
      <div className="line-labels">{series.map((s, i) => <span key={i}>{s.label}</span>)}</div>
    </div>
  );
}

function ListBody({ w }) {
  const items = w.config?.items || [];
  if (!items.length) return <p className="widget-muted">No items.</p>;
  return (
    <div className="widget-list">
      {items.map((it, i) => (
        <div className="widget-list-row" key={i}>
          <span className="wl-dot" />
          <span className="wl-text"><b>{it.title}</b>{it.sub && <small>{it.sub}</small>}</span>
          {it.badge && <span className="wl-badge">{it.badge}</span>}
        </div>
      ))}
    </div>
  );
}

function ProgressBody({ w }) {
  const rows = w.config?.rows || [];
  return (
    <div className="widget-progress">
      {rows.map((r, i) => {
        const pct = Math.min(100, Math.round((Number(r.value) / (Number(r.max) || 100)) * 100));
        return (
          <div className="progress-row" key={i}>
            <div className="progress-top"><span>{r.label}</span><b>{pct}%</b></div>
            <div className="progress-track"><span style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function QuickActionsBody({ w }) {
  const { user } = useAuth();
  const actions = usableQuickActions(user, w.config?.actionIds || []);
  return (
    <div className="widget-actions">
      {actions.map((a) => (
        <Link key={a.id} to={a.to} className="widget-action">
          <span className="wa-glyph"><Icon name={a.icon} size={16} /></span>
          <span>{a.label}</span>
        </Link>
      ))}
    </div>
  );
}

function NoteBody({ w, editing, onUpdate }) {
  if (editing) {
    return <textarea className="note-input" value={w.config?.text || ''} onChange={(e) => onUpdate(w.id, { config: { text: e.target.value } })} />;
  }
  return <p className="note-text">{w.config?.text || 'Empty note.'}</p>;
}

function LinkBody({ w }) {
  const c = w.config || {};
  return (
    <Link to={c.to || '/'} className="widget-link">
      <span className="wl-glyph"><Icon name="Link2" size={18} /></span>
      <span className="wl-body"><b>{c.label || 'Open'}</b><small>{c.description || c.to}</small></span>
      <Icon name="ArrowUpRight" size={16} />
    </Link>
  );
}

function AddWidgetTile({ onAdd }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="widget add-widget size-md">
      {!open ? (
        <button className="add-widget-cta" onClick={() => setOpen(true)}>
          <span className="add-plus"><Icon name="Plus" size={22} /></span>
          <b>Add a widget</b>
          <small>Metrics, charts, lists and more</small>
        </button>
      ) : (
        <div className="add-widget-menu">
          <div className="awm-head"><b>Choose a widget</b><button className="mini-icon" onClick={() => setOpen(false)}><Icon name="X" size={14} /></button></div>
          <div className="awm-grid">
            {CATALOG.map((c) => (
              <button key={c.type} className="awm-item" onClick={() => { onAdd(blankWidget(c.type)); setOpen(false); }}>
                <span className="awm-glyph"><Icon name={c.icon} size={17} /></span>
                <span className="awm-text"><b>{c.name}</b><small>{c.desc}</small></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

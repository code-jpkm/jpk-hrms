import React from 'react';
import { TableSkeleton } from './Loading.jsx';

export function Card({ title, children, actions, id, className = '' }) {
  return (
    <section className={`card premium-card ${className}`.trim()} id={id}>
      {(title || actions) && <div className="card-head">
        <h2>{title}</h2>
        {actions && <div className="card-actions">{actions}</div>}
      </div>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }) {
  return <div className="stat premium-stat"><div>{value}</div><span>{label}</span>{hint && <small>{hint}</small>}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error-box" role="alert"><b>Something needs attention</b><span>{String(error.message || error)}</span></div>;
}

export function Empty({ children = 'No data found.' }) {
  return <div className="empty"><span className="empty-orb" aria-hidden="true" /><b>Nothing here yet</b><span>{children}</span></div>;
}

export function Table({ columns, rows = [], renderRow, loading = false, skeletonRows = 6, initialRows = 8 }) {
  const [expanded, setExpanded] = React.useState(false);
  if (loading) return <TableSkeleton rows={skeletonRows} columns={Math.max(2, columns?.length || 5)} />;
  const long = rows.length > initialRows;
  const visibleRows = long && !expanded ? rows.slice(0, initialRows) : rows;
  return (
    <div className="progressive-table-shell">
      <div className="table-wrap premium-table-wrap">
        <table>
          <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{visibleRows.map(renderRow)}</tbody>
        </table>
      </div>
      {long && <button type="button" className="table-expand-control" onClick={() => setExpanded((value) => !value)}>
        <span>{expanded ? 'Show less' : `Show all ${rows.length}`}</span>
        <small>{expanded ? 'Collapse long data' : `${rows.length - initialRows} more rows hidden by default`}</small>
        <b>{expanded ? '↑' : '↓'}</b>
      </button>}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="field-hint">{hint}</small>}</label>;
}

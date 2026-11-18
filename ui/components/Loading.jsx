import React from 'react';

export function Skeleton({ className = '', style }) {
  return <span className={`ui-skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}

export function RouteSkeleton({ compact = false }) {
  return (
    <div className={`route-skeleton ${compact ? 'compact' : ''}`} role="status" aria-live="polite" aria-label="Loading page">
      <section className="route-skeleton-hero">
        <div>
          <Skeleton className="sk-eyebrow" />
          <Skeleton className="sk-title" />
          <Skeleton className="sk-copy" />
        </div>
        <Skeleton className="sk-action" />
      </section>
      <section className="route-skeleton-toolbar">
        <Skeleton className="sk-control wide" />
        <Skeleton className="sk-control" />
        <Skeleton className="sk-control" />
      </section>
      <div className="route-skeleton-grid">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <article className="route-skeleton-card" key={item}>
            <div className="sk-card-head"><Skeleton className="sk-avatar" /><div><Skeleton className="sk-line medium" /><Skeleton className="sk-line short" /></div></div>
            <Skeleton className="sk-line" /><Skeleton className="sk-line" /><Skeleton className="sk-line short" />
          </article>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }) {
  return (
    <div className="table-skeleton" role="status" aria-label="Loading data">
      <div className="table-skeleton-row head">{Array.from({ length: columns }).map((_, i) => <Skeleton key={i} className="sk-cell" />)}</div>
      {Array.from({ length: rows }).map((_, r) => <div className="table-skeleton-row" key={r}>{Array.from({ length: columns }).map((_, c) => <Skeleton key={c} className={`sk-cell ${c === 0 ? 'strong' : ''}`} />)}</div>)}
    </div>
  );
}

export function DirectorySkeleton({ count = 8 }) {
  return (
    <div className="people-directory-grid skeleton-directory" role="status" aria-label="Loading people">
      {Array.from({ length: count }).map((_, i) => (
        <article className="people-card skeleton-person" key={i}>
          <div className="people-card-top"><Skeleton className="sk-person-avatar" /><Skeleton className="sk-pill" /></div>
          <Skeleton className="sk-line medium" /><Skeleton className="sk-line short" />
          <div className="sk-chip-row"><Skeleton className="sk-pill" /><Skeleton className="sk-pill" /></div>
          <Skeleton className="sk-line short" />
        </article>
      ))}
    </div>
  );
}

export function InlineSkeleton({ label = 'Loading…' }) {
  return <div className="inline-skeleton" role="status" aria-label={label}><Skeleton className="sk-line" /><Skeleton className="sk-line medium" /></div>;
}

export function DataLoadingLayer() {
  return (
    <div className="data-loading-layer youtube-skeleton" aria-hidden="true">
      <section className="yt-sk-hero">
        <div><Skeleton className="sk-eyebrow" /><Skeleton className="sk-title" /><Skeleton className="sk-copy" /></div>
        <Skeleton className="sk-action" />
      </section>
      <div className="yt-sk-filters">
        <Skeleton className="sk-chip" /><Skeleton className="sk-chip wide" /><Skeleton className="sk-chip" /><Skeleton className="sk-chip" />
      </div>
      <div className="yt-sk-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <article className="yt-sk-card" key={i}>
            <Skeleton className="yt-sk-thumb" />
            <div className="yt-sk-meta"><Skeleton className="sk-avatar" /><div><Skeleton className="sk-line" /><Skeleton className="sk-line medium" /><Skeleton className="sk-line short" /></div></div>
          </article>
        ))}
      </div>
    </div>
  );
}

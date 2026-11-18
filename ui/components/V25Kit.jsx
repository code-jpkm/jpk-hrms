import React, { useState } from 'react';
import Icon from './Icon.jsx';

/**
 * Section — collapsed by DEFAULT.
 * Uses native <details> so it works without JS state and stays accessible.
 * Long data no longer floods the page; the user opts in to each block.
 */
export function Section({ icon = 'LayoutGrid', title, subtitle, count, defaultOpen = false, children }) {
  return (
    <details className="v25-section" open={defaultOpen}>
      <summary>
        <span className="v25-glyph"><Icon name={icon} size={18} /></span>
        <span>
          <h3>{title}</h3>
          {subtitle && <small>{subtitle}</small>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {count !== undefined && <span className="v25-count-chip">{count}</span>}
          <Icon className="v25-chevron" name="ChevronDown" size={17} />
        </span>
      </summary>
      <div className="v25-section-body">{children}</div>
    </details>
  );
}

const inr = (value) => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * MaskedAmount — salary figures are hidden until the eye is clicked.
 * Each row owns its own state, so revealing one person's pay never reveals
 * anyone else's. That is the behaviour asked for: nothing visible by default.
 */
export function MaskedAmount({ value, prefix = '₹', label = 'amount' }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={`v25-amount ${shown ? '' : 'is-hidden'}`}>
      <b>{shown ? `${prefix}${inr(value)}` : '••••••'}</b>
      <button
        type="button"
        className="v25-eye"
        aria-label={shown ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={shown}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShown((v) => !v); }}
      >
        <Icon name={shown ? 'EyeOff' : 'Eye'} size={15} />
      </button>
    </span>
  );
}

/** Reveal-all / hide-all controller for a whole table of MaskedAmounts. */
export function MaskedAmountGroup({ children, defaultShown = false }) {
  const [shown, setShown] = useState(defaultShown);
  return (
    <div>
      <button type="button" className="v25-eye" style={{ width: 'auto', padding: '0 12px', gap: 8, display: 'inline-flex' }} onClick={() => setShown((v) => !v)}>
        <Icon name={shown ? 'EyeOff' : 'Eye'} size={15} />
        <span style={{ fontSize: 12, fontWeight: 800 }}>{shown ? 'Hide all amounts' : 'Reveal all amounts'}</span>
      </button>
      <div data-amounts-shown={shown ? 'true' : 'false'}>{children}</div>
    </div>
  );
}

/** Compact checkbox row — replaces the oversized native boxes. */
export function CheckRow({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`v25-check-row ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function CheckGrid({ children }) {
  return <div className="v25-check-grid">{children}</div>;
}

/**
 * MonthAccordion — payroll runs collapsed to one row per month.
 * The totals for that month only load/expand when the month is opened.
 */
export function MonthAccordion({ month, status = 'DRAFT', summaryLine, right, children }) {
  const [y, m] = String(month || '').split('-');
  const label = m ? new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-IN', { month: 'short' }) : '—';
  return (
    <details className="v25-month">
      <summary>
        <span className="v25-month-badge">
          <strong>{label}</strong>
          <span>{y}</span>
        </span>
        <span>
          <b style={{ fontSize: 14.5 }}>Payroll {month}</b>
          {summaryLine && <small style={{ display: 'block', color: '#807F84', fontSize: 12, marginTop: 3, fontWeight: 600 }}>{summaryLine}</small>}
        </span>
        <span className={`v25-status ${String(status).toLowerCase()}`}>{status}</span>
        {right}
      </summary>
      <div className="v25-month-body">{children}</div>
    </details>
  );
}

/** Inline anomaly / rule-explanation banner. */
export function Flag({ children, icon = 'AlertTriangle' }) {
  if (!children) return null;
  return (
    <div className="v25-flag">
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </div>
  );
}

export default { Section, MaskedAmount, MaskedAmountGroup, CheckRow, CheckGrid, MonthAccordion, Flag };

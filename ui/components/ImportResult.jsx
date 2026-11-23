import React from 'react';
import '../styles/login.css';

/**
 * What an Excel import did: the counts, the rows that did not go in and the
 * rows that went in with something to check. Each row: { row, employeeCode, message }.
 */
export default function ImportResult({ title, facts = [], errors = [], warnings = [], onClose }) {
  const where = (r) => [r.row ? `Row ${r.row}` : '', r.employeeCode || ''].filter(Boolean).join(' · ');
  return <section className="import-result" role="status">
    <div className="import-result-head">
      <div><b>{title}</b><span>{facts.filter(Boolean).join(' · ')}</span></div>
      {onClose && <button type="button" onClick={onClose}>Close</button>}
    </div>
    {errors.length > 0 && <div className="import-result-list bad">
      <p>Not imported ({errors.length})</p>
      <ul>{errors.map((r, i) => <li key={`e${i}`}><b>{where(r)}</b> {r.message}</li>)}</ul>
    </div>}
    {warnings.length > 0 && <div className="import-result-list warn">
      <p>Imported, but check ({warnings.length})</p>
      <ul>{warnings.map((r, i) => <li key={`w${i}`}><b>{where(r)}</b> {r.message}</li>)}</ul>
    </div>}
    {!errors.length && !warnings.length && <p className="import-result-ok">Every row went in.</p>}
  </section>;
}

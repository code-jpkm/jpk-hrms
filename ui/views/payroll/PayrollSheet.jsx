import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, put } from '../../api/client.js';
import LopAttendance from './LopAttendance.jsx';
import '../../styles/payrollsheet.css';

/**
 * The payroll sheet: every payslip of a month in one Excel-like table.
 *
 * Arrows / Tab / Enter move like Excel; typing replaces a cell, Enter or F2
 * edits it; Delete puts an amount back to the calculated one; Ctrl+C / Ctrl+V
 * copy and paste blocks (to and from Excel); Ctrl+Z / Ctrl+Y undo and redo;
 * Ctrl+S saves. Gross, deductions and net pay follow as you type. Saving writes
 * the changed amounts into each payslip (PUT /payroll/runs/:id/sheet), so the
 * payslip PDF, salary sheet and totals show them.
 *
 * LOP comes from attendance: its cell opens the person's month to mark days
 * present / half day / absent, and the row is read again from the payslip.
 */

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const money = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const daysText = (v) => (v === null || v === undefined ? '' : String(round2(v)));
const monthTitle = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const readAmount = (text) => {
  const cleaned = String(text ?? '').replace(/[₹,\s]/g, '');
  if (cleaned === '') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 && n <= 1e8 ? round2(n) : null;
};

function buildColumns(columns) {
  const e = columns.earnings.map((c) => ({ key: c.ref, label: c.label, kind: 'money', side: 'E' }));
  const d = columns.deductions.map((c) => ({ key: c.ref, label: c.label, kind: 'money', side: 'D' }));
  return [
    { key: 'code', label: 'Code', kind: 'text', ro: true, stick: 'a' },
    { key: 'name', label: 'Name', kind: 'text', ro: true, stick: 'b' },
    { key: 'working', label: 'Days', kind: 'days', ro: true },
    { key: 'payable', label: 'Paid days', kind: 'days', ro: true },
    { key: 'lop', label: 'LOP', kind: 'lop' },
    ...e,
    { key: 'X:E', label: 'ADDED EARNING', kind: 'money', side: 'E', extra: true },
    { key: 'gross', label: 'GROSS', kind: 'money', ro: true, calc: true },
    ...d,
    { key: 'X:D', label: 'ADDED DEDUCTION', kind: 'money', side: 'D', extra: true },
    { key: 'ded', label: 'DEDUCTIONS', kind: 'money', ro: true, calc: true },
    { key: 'net', label: 'NET PAY', kind: 'money', ro: true, calc: true },
    { key: 'NOTE', label: 'Note on payslip', kind: 'note' }
  ];
}

export default function PayrollSheet({ runId, month, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState({});
  const [history, setHistory] = useState({ undo: [], redo: [] });
  const [sel, setSel] = useState({ r: 0, c: 2 });
  const [anchor, setAnchor] = useState(null);
  const [editing, setEditingState] = useState(null);
  const editingRef = useRef(null);
  const setEditing = (value) => {
    const next = typeof value === 'function' ? value(editingRef.current) : value;
    editingRef.current = next;
    setEditingState(next);
  };
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState({ kind: '', text: '' });
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [lopFor, setLopFor] = useState(null);
  const [closing, setClosing] = useState(false);
  const gridRef = useRef(null);
  const dragging = useRef(false);

  const load = useCallback(async ({ keep = false } = {}) => {
    setLoadError('');
    try {
      const res = await api(`/payroll/runs/${runId}/sheet`);
      setData(res);
      if (!keep) { setPending({}); setHistory({ undo: [], redo: [] }); }
      setStale(false);
    } catch (err) {
      setLoadError(err.message || 'Could not load the payroll sheet');
    }
  }, [runId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (data) gridRef.current?.focus(); }, [Boolean(data)]); // eslint-disable-line react-hooks/exhaustive-deps

  const cols = useMemo(() => (data ? buildColumns(data.columns) : []), [data]);
  const amountCols = useMemo(() => cols.filter((c) => c.kind === 'money' && !c.calc), [cols]);
  const canEdit = Boolean(data?.canEdit);
  const rows = useMemo(() => {
    const all = data?.rows || [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => `${r.employeeCode} ${r.name} ${r.department} ${r.designation}`.toLowerCase().includes(q));
  }, [data, search]);
  const rowsById = useMemo(() => new Map((data?.rows || []).map((r) => [r.slipId, r])), [data]);
  const changeCount = useMemo(() => Object.values(pending).reduce((t, cells) => t + Object.keys(cells).length, 0), [pending]);
  const changedPeople = Object.keys(pending).length;

  /* ---------------------------------------------------------- values */

  const original = useCallback((row, key) => {
    if (key === 'NOTE') return row.notes || '';
    if (key === 'X:E') return row.extra.E.amount;
    if (key === 'X:D') return row.extra.D.amount;
    return row.lines[key]?.amount ?? 0;
  }, []);

  const valueOf = useCallback((row, col) => {
    const p = pending[row.slipId];
    switch (col.key) {
      case 'code': return row.employeeCode;
      case 'name': return row.name;
      case 'working': return row.days.working;
      case 'payable': return row.days.payable;
      case 'lop': return row.days.lop;
      case 'gross':
      case 'ded':
      case 'net': {
        let gross = 0;
        let ded = 0;
        for (const c of amountCols) {
          const v = Number(p && p[c.key] !== undefined ? p[c.key] : original(row, c.key)) || 0;
          if (c.side === 'E') gross += v; else ded += v;
        }
        return round2(col.key === 'gross' ? gross : col.key === 'ded' ? ded : gross - ded);
      }
      default:
        return p && p[col.key] !== undefined ? p[col.key] : original(row, col.key);
    }
  }, [pending, amountCols, original]);

  const editable = useCallback((row, col) => {
    if (!canEdit || !row || !col || col.ro || col.kind === 'lop') return false;
    if (col.extra) return row.extra[col.side].count <= 1;
    return true;
  }, [canEdit]);

  const shown = (row, col) => {
    const v = valueOf(row, col);
    if (col.kind === 'money') return money(v);
    if (col.kind === 'days' || col.kind === 'lop') return daysText(v);
    return v;
  };

  /* ---------------------------------------------------------- changes */

  /** Applies [{slipId, key, value}] as one undoable step; a value equal to the saved one clears the change. */
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const applyChanges = useCallback((list, label = '') => {
    if (!list.length) return;
    const next = { ...pendingRef.current };
    const step = [];
    for (const { slipId, key, value } of list) {
      const row = rowsById.get(slipId);
      if (!row) continue;
      const before = next[slipId]?.[key];
      const same = key === 'NOTE' ? String(value) === String(original(row, key)) : Math.abs(Number(value) - Number(original(row, key))) < 0.005;
      const cells = { ...(next[slipId] || {}) };
      if (same) delete cells[key]; else cells[key] = value;
      if (Object.keys(cells).length) next[slipId] = cells; else delete next[slipId];
      const after = next[slipId]?.[key];
      if (before !== after) step.push({ slipId, key, before, after });
    }
    pendingRef.current = next;
    setPending(next);
    if (step.length) setHistory((h) => ({ undo: [...h.undo.slice(-199), step], redo: [] }));
    if (label) setStatus({ kind: 'info', text: label });
  }, [rowsById, original]);

  function replay(step, direction) {
    setPending((prev) => {
      const next = { ...prev };
      for (const { slipId, key, before, after } of step) {
        const value = direction === 'undo' ? before : after;
        const cells = { ...(next[slipId] || {}) };
        if (value === undefined) delete cells[key]; else cells[key] = value;
        if (Object.keys(cells).length) next[slipId] = cells; else delete next[slipId];
      }
      return next;
    });
  }
  function undo() {
    const step = history.undo[history.undo.length - 1];
    if (!step) return;
    replay(step, 'undo');
    setHistory((h) => ({ undo: h.undo.slice(0, -1), redo: [...h.redo, step] }));
    setStatus({ kind: 'info', text: 'Undone.' });
  }
  function redo() {
    const step = history.redo[history.redo.length - 1];
    if (!step) return;
    replay(step, 'redo');
    setHistory((h) => ({ undo: [...h.undo, step], redo: h.redo.slice(0, -1) }));
    setStatus({ kind: 'info', text: 'Redone.' });
  }

  /* ---------------------------------------------------------- selection */

  const range = useMemo(() => {
    const a = anchor || sel;
    return { r1: Math.min(a.r, sel.r), r2: Math.max(a.r, sel.r), c1: Math.min(a.c, sel.c), c2: Math.max(a.c, sel.c) };
  }, [anchor, sel]);
  const inRange = (r, c) => r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;

  useEffect(() => {
    if (!rows.length) return;
    if (sel.r > rows.length - 1) setSel((s) => ({ ...s, r: rows.length - 1 }));
  }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = gridRef.current?.querySelector(`[data-cell="${sel.r}:${sel.c}"]`);
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel]);

  function moveTo(r, c, extend = false) {
    const nr = Math.max(0, Math.min(rows.length - 1, r));
    const nc = Math.max(0, Math.min(cols.length - 1, c));
    if (extend) setAnchor((a) => a || sel); else setAnchor(null);
    setSel({ r: nr, c: nc });
  }

  /* ---------------------------------------------------------- editing */

  function startEdit(mode, firstKey) {
    const row = rows[sel.r];
    const col = cols[sel.c];
    if (!row || !col) return;
    if (col.kind === 'lop') { openLop(row); return; }
    if (!editable(row, col)) {
      if (col.extra && row.extra[col.side].count > 1) setStatus({ kind: 'warn', text: `${row.name} has ${row.extra[col.side].count} added lines (${row.extra[col.side].labels.join(', ')}). Open the payslip to change them.` });
      else if (!canEdit && !col.ro) setStatus({ kind: 'warn', text: 'You can see the sheet but not change payslips. Please contact your administrator / HR.' });
      return;
    }
    const current = valueOf(row, col);
    setAnchor(null);
    setEditing({ r: sel.r, c: sel.c, mode, text: firstKey !== undefined ? firstKey : (col.kind === 'note' ? String(current || '') : String(round2(current))) });
  }

  function commitEdit(moveBy) {
    const current = editingRef.current;
    if (!current) return true;
    const row = rows[current.r];
    const col = cols[current.c];
    let value;
    if (col.kind === 'note') value = String(current.text || '').trim().slice(0, 600);
    else {
      value = readAmount(current.text);
      if (value === null) {
        setStatus({ kind: 'error', text: `${col.label}: enter an amount of 0 or more (for example 12500).` });
        return false;
      }
    }
    setEditing(null);
    applyChanges([{ slipId: row.slipId, key: col.key, value }]);
    setStatus({ kind: '', text: '' });
    if (moveBy) moveTo(current.r + moveBy[0], current.c + moveBy[1]);
    requestAnimationFrame(() => gridRef.current?.focus());
    return true;
  }

  function cancelEdit() {
    setEditing(null);
    setStatus((st) => (st.kind === 'error' ? { kind: '', text: '' } : st));
    requestAnimationFrame(() => gridRef.current?.focus());
  }

  /** Delete / Backspace: amounts back to the calculated figure, added lines to 0, notes empty. */
  function clearRange() {
    const list = [];
    let skipped = 0;
    for (let r = range.r1; r <= range.r2; r += 1) {
      for (let c = range.c1; c <= range.c2; c += 1) {
        const row = rows[r];
        const col = cols[c];
        if (!editable(row, col)) { if (col && !col.ro && col.kind !== 'lop') skipped += 1; continue; }
        const value = col.kind === 'note' ? '' : col.extra ? 0 : (row.lines[col.key]?.calculated ?? 0);
        list.push({ slipId: row.slipId, key: col.key, value });
      }
    }
    applyChanges(list, list.length ? `${list.length} cell${list.length === 1 ? '' : 's'} put back to the calculated amount${skipped ? ` (${skipped} skipped)` : ''}.` : '');
  }

  /* ---------------------------------------------------------- clipboard */

  function onCopy(e) {
    if (editing) return;
    const lines = [];
    for (let r = range.r1; r <= range.r2; r += 1) {
      const cells = [];
      for (let c = range.c1; c <= range.c2; c += 1) {
        const row = rows[r];
        const col = cols[c];
        const v = valueOf(row, col);
        cells.push(col.kind === 'note' || col.kind === 'text' ? String(v ?? '').replace(/[\t\n]/g, ' ') : String(round2(v)));
      }
      lines.push(cells.join('\t'));
    }
    e.preventDefault();
    e.clipboardData.setData('text/plain', lines.join('\n'));
    setStatus({ kind: 'info', text: `Copied ${range.r2 - range.r1 + 1} × ${range.c2 - range.c1 + 1} cells.` });
  }

  function onPaste(e) {
    if (editing) return;
    e.preventDefault();
    if (!canEdit) { setStatus({ kind: 'warn', text: 'You can see the sheet but not change payslips. Please contact your administrator / HR.' }); return; }
    const text = e.clipboardData.getData('text/plain') || '';
    const grid = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((line) => line.split('\t'));
    if (!grid.length) return;
    // One value pasted over a selected block fills the whole block.
    const fill = grid.length === 1 && grid[0].length === 1 && (range.r2 > range.r1 || range.c2 > range.c1);
    const height = fill ? range.r2 - range.r1 + 1 : grid.length;
    const width = fill ? range.c2 - range.c1 + 1 : Math.max(...grid.map((g) => g.length));
    const list = [];
    let skipped = 0;
    let bad = 0;
    for (let i = 0; i < height; i += 1) {
      for (let j = 0; j < width; j += 1) {
        const row = rows[range.r1 + i];
        const col = cols[range.c1 + j];
        const raw = fill ? grid[0][0] : grid[i]?.[j];
        if (!row || !col || raw === undefined) continue;
        if (!editable(row, col)) { if (!col.ro && col.kind !== 'lop') skipped += 1; continue; }
        if (col.kind === 'note') { list.push({ slipId: row.slipId, key: col.key, value: String(raw).trim().slice(0, 600) }); continue; }
        const value = readAmount(raw);
        if (value === null) { bad += 1; continue; }
        list.push({ slipId: row.slipId, key: col.key, value });
      }
    }
    applyChanges(list, `Pasted ${list.length} cell${list.length === 1 ? '' : 's'}${bad ? `; ${bad} not an amount` : ''}${skipped ? `; ${skipped} can't be changed here` : ''}.`);
    setAnchor({ r: range.r1, c: range.c1 });
    setSel({ r: Math.min(rows.length - 1, range.r1 + height - 1), c: Math.min(cols.length - 1, range.c1 + width - 1) });
  }

  /* ---------------------------------------------------------- keys */

  function onKeyDown(e) {
    if (editing || lopFor || closing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setSel({ r: rows.length - 1, c: cols.length - 1 }); return; }
    if (mod) return;
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
    if (step) { e.preventDefault(); moveTo(sel.r + step[0], sel.c + step[1], e.shiftKey); return; }
    if (k === 'Tab') { e.preventDefault(); const nc = sel.c + (e.shiftKey ? -1 : 1); if (nc >= cols.length) moveTo(sel.r + 1, 2); else if (nc < 0) moveTo(sel.r - 1, cols.length - 1); else moveTo(sel.r, nc); return; }
    if (k === 'Home') { e.preventDefault(); moveTo(sel.r, 0, e.shiftKey); return; }
    if (k === 'End') { e.preventDefault(); moveTo(sel.r, cols.length - 1, e.shiftKey); return; }
    if (k === 'PageDown') { e.preventDefault(); moveTo(sel.r + 15, sel.c, e.shiftKey); return; }
    if (k === 'PageUp') { e.preventDefault(); moveTo(sel.r - 15, sel.c, e.shiftKey); return; }
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); startEdit('edit'); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearRange(); return; }
    if (k === 'Escape') { if (anchor) { e.preventDefault(); setAnchor(null); } return; }
    if (k.length === 1 && !e.altKey) {
      const col = cols[sel.c];
      if (col?.kind === 'lop') { if (k === ' ') { e.preventDefault(); openLop(rows[sel.r]); } return; }
      if (col?.kind === 'money' && !/[\d.₹]/.test(k)) return;
      e.preventDefault();
      startEdit('enter', k);
    }
  }

  function onEditKeyDown(e) {
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); commitEdit([e.shiftKey ? -1 : 1, 0]); return; }
    if (k === 'Tab') { e.preventDefault(); commitEdit([0, e.shiftKey ? -1 : 1]); return; }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); return; }
    if (editingRef.current?.mode === 'enter') {
      const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      if (step) { e.preventDefault(); commitEdit(step); }
    }
  }

  /* ---------------------------------------------------------- LOP popup */

  function openLop(row) {
    if (!row) return;
    setLopFor(row);
  }

  async function lopChanged(row) {
    try {
      const res = await api(`/payroll/runs/${runId}/sheet?employeeId=${row.employeeId}`);
      const fresh = res.rows?.[0];
      if (!fresh) return;
      setData((d) => ({ ...d, columns: res.columns, rows: d.rows.map((r) => (r.slipId === fresh.slipId ? fresh : r)), run: res.run }));
      const lopBefore = Number(row.days.lop || 0);
      const lopAfter = Number(fresh.days.lop || 0);
      setStatus({ kind: 'info', text: data?.run?.status === 'FINALIZED'
        ? `${fresh.name}: attendance changed. This month is released, so the payslip stays as it was.`
        : `${fresh.name}: LOP ${daysText(lopBefore)} → ${daysText(lopAfter)} day${lopAfter === 1 ? '' : 's'}; the payslip was worked out again.` });
      onSaved?.();
    } catch (err) {
      setStatus({ kind: 'error', text: err.message || 'Could not read the payslip again' });
    }
  }

  /* ---------------------------------------------------------- save */

  async function save() {
    if (editingRef.current && !commitEdit()) return;
    if (saving || !data || !Object.keys(pendingRef.current).length) return;
    const changes = Object.entries(pendingRef.current).map(([slipId, cells]) => {
      const row = rowsById.get(slipId);
      const change = { slipId, version: row?.version };
      for (const [key, value] of Object.entries(cells)) {
        if (key === 'NOTE') change.notes = value;
        else if (key === 'X:E' || key === 'X:D') change.extra = { ...(change.extra || {}), [key.slice(2)]: value };
        else change.set = { ...(change.set || {}), [key]: value };
      }
      return change;
    });
    setSaving(true);
    setStatus({ kind: 'info', text: 'Saving…' });
    try {
      const res = await put(`/payroll/runs/${runId}/sheet`, { changes, reason: 'Edited in the payroll sheet' }, { toast: false });
      const fresh = new Map((res.rows || []).map((r) => [r.slipId, r]));
      setData((d) => ({ ...d, columns: res.columns || d.columns, rows: d.rows.map((r) => fresh.get(r.slipId) || r), run: { ...d.run, summary: res.summary || d.run.summary } }));
      setPending({});
      setHistory({ undo: [], redo: [] });
      setStatus({ kind: 'ok', text: res.message || 'Saved.' });
      onSaved?.();
    } catch (err) {
      if (err.status === 409) setStale(true);
      setStatus({ kind: 'error', text: err.message || 'Could not save the sheet' });
    } finally {
      setSaving(false);
      requestAnimationFrame(() => gridRef.current?.focus());
    }
  }

  function close() {
    if (changeCount) { setClosing(true); return; }
    onClose();
  }

  async function downloadExcel() {
    try {
      const blob = await api(`/payroll/runs/${runId}/salary-sheet.xlsx`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `salary-statement-${month}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setStatus({ kind: 'error', text: err.message || 'Could not download the Excel file' });
    }
  }

  /* ---------------------------------------------------------- render */

  const totals = useMemo(() => {
    const out = {};
    for (const col of cols) {
      if (!['money', 'days', 'lop'].includes(col.kind)) continue;
      out[col.key] = round2(rows.reduce((t, row) => t + (Number(valueOf(row, col)) || 0), 0));
    }
    return out;
  }, [cols, rows, valueOf]);

  const released = data?.run?.status === 'FINALIZED';
  const active = rows[sel.r];
  const activeCol = cols[sel.c];
  const activeHint = (() => {
    if (!active || !activeCol) return '';
    if (activeCol.kind === 'lop') return `${active.name}: ${daysText(active.days.lop)} LOP day(s)${active.days.review ? ` · ${active.days.review} day(s) with an out time missing` : ''}. Press Enter to open the month and change days.`;
    if (activeCol.kind === 'money' && !activeCol.calc && !activeCol.extra) {
      const line = active.lines[activeCol.key];
      if (!line) return '';
      const p = pending[active.slipId]?.[activeCol.key];
      if (p !== undefined) return `${activeCol.label}: ₹${money(p)} (not saved) · calculated ₹${money(line.calculated)}.`;
      return line.edited ? `${activeCol.label} changed by HR: ₹${money(line.amount)} · calculated ₹${money(line.calculated)}. Delete puts it back.` : `${activeCol.label}: calculated ₹${money(line.calculated)}.`;
    }
    if (activeCol.extra) {
      const x = active.extra[activeCol.side];
      return x.count > 1 ? `${x.count} added lines (${x.labels.join(', ')}). Open the payslip to change them.` : x.count === 1 ? `Added line "${x.labels[0]}" on the payslip.` : 'Type an amount to add an ADJUSTMENT line to the payslip.';
    }
    if (activeCol.kind === 'note') return 'Printed on the payslip as "Note: …".';
    return '';
  })();

  return (
    <div className="psheet-back" role="presentation">
      <section className="psheet" role="dialog" aria-label={`Payroll sheet, ${monthTitle(month)}`}>
        <header className="psheet-head">
          <div className="psheet-title">
            <small>PAYROLL SHEET</small>
            <h2>{monthTitle(month)} <span className={`psheet-chip ${released ? 'rel' : 'draft'}`}>{released ? 'Released' : 'Draft'}</span></h2>
          </div>
          <label className="psheet-search">
            <Icon name="Search" size={15} />
            <input className="psheet-q" value={search} onChange={(e) => { setSearch(e.target.value); setSel({ r: 0, c: sel.c }); setAnchor(null); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); gridRef.current?.focus(); } }} placeholder="Find a person, code or department" aria-label="Find a person" />
          </label>
          <div className="psheet-tools">
            <button type="button" className="secondary" onClick={undo} disabled={!history.undo.length} title="Undo (Ctrl+Z)"><Icon name="Undo2" size={15} /> Undo</button>
            <button type="button" className="secondary" onClick={redo} disabled={!history.redo.length} title="Redo (Ctrl+Y)"><Icon name="RotateCcw" size={15} style={{ transform: 'scaleX(-1)' }} /> Redo</button>
            <button type="button" className="secondary" onClick={downloadExcel} title="Download the salary statement as Excel"><Icon name="FileDown" size={15} /> Excel</button>
            {canEdit && <button type="button" className="secondary" onClick={() => { setPending({}); setHistory({ undo: [], redo: [] }); setStatus({ kind: 'info', text: 'Changes discarded.' }); }} disabled={!changeCount}>Discard</button>}
            {canEdit && <button type="button" className="primary" onClick={save} disabled={!changeCount || saving}><Icon name={saving ? 'Loader2' : 'Save'} size={15} className={saving ? 'spin' : ''} /> {saving ? 'Saving…' : changeCount ? `Save ${changeCount} change${changeCount === 1 ? '' : 's'}` : 'Saved'}</button>}
            <button type="button" className="psheet-icon" onClick={close} aria-label="Close the payroll sheet"><Icon name="X" size={18} /></button>
          </div>
        </header>

        {released && <p className="psheet-banner"><Icon name="Info" size={14} /> {monthTitle(month)} is released. You can still correct payslips here; anyone already sent a payslip must be sent the corrected one.</p>}
        {!canEdit && data && <p className="psheet-banner"><Icon name="Lock" size={14} /> You can see the sheet but not change payslips. Please contact your administrator / HR.</p>}
        {stale && <p className="psheet-banner warn"><Icon name="TriangleAlert" size={14} /> A payslip changed after you opened the sheet. <button type="button" className="secondary" onClick={() => load({ keep: true })}>Reload, keep my changes</button></p>}
        {loadError && <p className="psheet-banner warn">{loadError} <button type="button" className="secondary" onClick={() => load()}>Try again</button></p>}
        {!data && !loadError && <p className="psheet-loading"><Icon name="Loader2" size={16} className="spin" /> Loading the payslips…</p>}

        {data && (
          <div
            className="psheet-grid"
            ref={gridRef}
            tabIndex={0}
            role="grid"
            aria-label="Payslips"
            aria-rowcount={rows.length + 1}
            aria-colcount={cols.length}
            onKeyDown={onKeyDown}
            onCopy={onCopy}
            onPaste={onPaste}
            onMouseUp={() => { dragging.current = false; }}
          >
            <table>
              <thead>
                <tr>
                  {cols.map((col, c) => (
                    <th key={col.key} className={`k-${col.kind}${col.stick ? ` stick-${col.stick}` : ''}${col.calc ? ' calc' : ''}${c === sel.c ? ' on' : ''}`} scope="col">{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={row.slipId} className={pending[row.slipId] ? 'dirty-row' : ''}>
                    {cols.map((col, c) => {
                      const isSel = r === sel.r && c === sel.c;
                      const isEditing = editing && editing.r === r && editing.c === c;
                      const dirty = pending[row.slipId]?.[col.key] !== undefined;
                      const pinned = !dirty && col.kind === 'money' && row.lines[col.key]?.edited;
                      const negative = col.key === 'net' && valueOf(row, col) < 0;
                      const cls = [
                        `k-${col.kind}`,
                        col.stick ? `stick-${col.stick}` : '',
                        col.calc ? 'calc' : '',
                        col.ro || (col.kind !== 'lop' && !editable(row, col)) ? 'ro' : '',
                        dirty ? 'dirty' : '',
                        pinned ? 'pinned' : '',
                        negative ? 'neg' : '',
                        isSel ? 'sel' : '',
                        inRange(r, c) && (range.r1 !== range.r2 || range.c1 !== range.c2) ? 'inrange' : ''
                      ].filter(Boolean).join(' ');
                      return (
                        <td
                          key={col.key}
                          className={cls}
                          data-cell={`${r}:${c}`}
                          role="gridcell"
                          aria-selected={isSel}
                          title={col.kind === 'lop' ? 'Open the month to change days' : pinned ? `Changed by HR · calculated ₹${money(row.lines[col.key]?.calculated)}` : undefined}
                          onMouseDown={(e) => { if (isEditing) return; e.preventDefault(); if (editingRef.current && !commitEdit()) return; gridRef.current?.focus(); dragging.current = true; if (e.shiftKey) { setAnchor((a) => a || sel); setSel({ r, c }); } else { setAnchor(null); setSel({ r, c }); } }}
                          onMouseEnter={() => { if (dragging.current) { setAnchor((a) => a || sel); setSel({ r, c }); } }}
                          onDoubleClick={() => { if (col.kind === 'lop') openLop(row); else startEdit('edit'); }}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              onFocus={(e) => { const n = e.target.value.length; e.target.setSelectionRange(n, n); }}
                              className="psheet-input"
                              value={editing.text}
                              inputMode={col.kind === 'note' ? 'text' : 'decimal'}
                              onChange={(e) => setEditing((ed) => ({ ...ed, text: e.target.value }))}
                              onKeyDown={onEditKeyDown}
                              onBlur={() => commitEdit()}
                              aria-label={`${col.label} for ${row.name}`}
                            />
                          ) : col.kind === 'lop' ? (
                            <button type="button" tabIndex={-1} className={`psheet-lop${Number(row.days.lop) > 0 ? ' has' : ''}`} onMouseDown={(e) => e.stopPropagation()} onClick={() => { setSel({ r, c }); openLop(row); }} aria-label={`LOP ${daysText(row.days.lop)} days for ${row.name}: open the month`}>
                              {daysText(row.days.lop)} <Icon name="CalendarDays" size={12} />{row.days.review ? <i className="review" title={`${row.days.review} day(s) with an out time missing`} /> : null}
                            </button>
                          ) : (
                            <span>{shown(row, col)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={cols.length} className="psheet-empty">{search ? 'Nobody matches the search.' : 'No payslips in this month yet.'}</td></tr>}
              </tbody>
              <tfoot>
                <tr>
                  {cols.map((col) => (
                    <td key={col.key} className={`k-${col.kind}${col.stick ? ` stick-${col.stick}` : ''}${col.calc ? ' calc' : ''}`}>
                      {col.key === 'code' ? 'Total' : col.key === 'name' ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'}` : totals[col.key] === undefined ? '' : col.kind === 'money' ? money(totals[col.key]) : daysText(totals[col.key])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <footer className="psheet-foot">
          <span className={`psheet-status ${status.kind}`} aria-live="polite">{status.text || activeHint || (changeCount ? `${changeCount} change${changeCount === 1 ? '' : 's'} for ${changedPeople} ${changedPeople === 1 ? 'person' : 'people'} not saved yet.` : '')}</span>
          <span className="psheet-keys"><kbd>↑↓←→</kbd> move · <kbd>Enter</kbd> edit · type to replace · <kbd>Del</kbd> back to calculated · <kbd>Ctrl</kbd>+<kbd>V</kbd> paste from Excel · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>S</kbd> save</span>
        </footer>

        {closing && (
          <div className="psheet-confirm" role="alertdialog" aria-label="Close without saving?">
            <p><b>{changeCount} change{changeCount === 1 ? '' : 's'} not saved.</b> Close the sheet without saving them?</p>
            <div>
              <button type="button" className="secondary" onClick={() => { setClosing(false); gridRef.current?.focus(); }}>Keep editing</button>
              <button type="button" className="secondary" onClick={() => { setClosing(false); save(); }}>Save</button>
              <button type="button" className="primary danger" onClick={() => { setClosing(false); onClose(); }}>Close without saving</button>
            </div>
          </div>
        )}
      </section>

      {lopFor && (
        <LopAttendance
          employee={{ employeeId: lopFor.employeeId, name: lopFor.name, employeeCode: lopFor.employeeCode }}
          month={month}
          released={released}
          canChange={Boolean(data?.canChangeAttendance)}
          onClose={() => { setLopFor(null); requestAnimationFrame(() => gridRef.current?.focus()); }}
          onChanged={() => lopChanged(lopFor)}
        />
      )}
    </div>
  );
}

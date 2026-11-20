import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, ErrorBox } from '../components/Ui.jsx';
import Icon from '../components/Icon.jsx';
import { post } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility } from '../utils/permissions.js';
import { departmentPalette, departmentsOf, indexOrgForest, personName } from '../utils/orgChartLayout.mjs';
import OrgTreeView from './hierarchy/OrgTreeView.jsx';
import '../styles/orgchart.css';

const VIEW_KEY = 'hrms_org_view';

function nameOf(node) { return personName(node); }
function initials(node) { return nameOf(node).split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'E'; }

function TreeNode({ node, level = 0, collapsed, toggle, onDragStart, onDropNode, canManage, makeRoot, highlightId }) {
  const isClosed = collapsed[node._id];
  const hasChildren = node.children?.length > 0;
  return <div className="tree-row-wrap">
    <div id={`org-row-${node._id}`} className={`tree-row level-${Math.min(level, 4)}${highlightId === node._id ? ' is-match' : ''}`} draggable={canManage} onDragStart={(e) => onDragStart(e, node._id)} onDragOver={(e) => canManage && e.preventDefault()} onDrop={(e) => onDropNode(e, node._id)}>
      <button className="collapse-btn" onClick={() => toggle(node._id)} aria-label={hasChildren ? (isClosed ? 'Show team' : 'Hide team') : undefined} disabled={!hasChildren}>{hasChildren ? (isClosed ? '▸' : '▾') : '•'}</button>
      <span className="tree-avatar">{initials(node)}</span>
      <div className="tree-person"><strong>{nameOf(node)}</strong><small>{node.employeeCode} · {node.designation || 'Employee'} · {node.department || '-'}</small></div>
      <span className="count-pill">{node.children?.length || 0} reports</span>
      {canManage && <button className="tiny-btn" onClick={() => makeRoot(node._id)}>Make top</button>}
    </div>
    {hasChildren && !isClosed && <div className="tree-children">{node.children.map((child) => <TreeNode key={child._id} node={child} level={level + 1} collapsed={collapsed} toggle={toggle} onDragStart={onDragStart} onDropNode={onDropNode} canManage={canManage} makeRoot={makeRoot} highlightId={highlightId} />)}</div>}
  </div>;
}

function flatten(nodes = [], out = []) { nodes.forEach((n) => { out.push(n); flatten(n.children || [], out); }); return out; }

/** Type a name, code, job or department; pick a person to show them on the chart. */
function PersonSearch({ people, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const matches = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return people.filter((p) => {
      const hay = `${nameOf(p)} ${p.employeeCode || ''} ${p.designation || ''} ${p.department || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    }).slice(0, 8);
  }, [q, people]);
  useEffect(() => {
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const pick = (p) => { onPick(String(p._id)); setQ(''); setOpen(false); };
  return (
    <div className="org-search" ref={boxRef}>
      <Icon name="Search" size={15} />
      <input
        value={q}
        placeholder="Find a person"
        aria-label="Find a person on the chart"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls="org-search-list"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && matches[active]) { e.preventDefault(); pick(matches[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim() && (
        <ul className="org-search-list" id="org-search-list" role="listbox">
          {matches.length ? matches.map((p, i) => (
            <li key={p._id} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''} onPointerDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setActive(i)}>
              <b>{nameOf(p)}</b>
              <small>{[p.employeeCode, p.designation, p.department].filter(Boolean).join(' · ')}</small>
            </li>
          )) : <li className="org-search-none">Nobody matches.</li>}
        </ul>
      )}
    </div>
  );
}

/** PDF of what is on screen. The tree can be one big page, or A4 / A3 sheets ready to print. */
function DownloadPdf({ view, busy, onDownload }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  if (view === 'list') {
    return <button type="button" className="org-download" onClick={() => onDownload('A4')} disabled={busy}><Icon name="FileDown" size={16} /> {busy ? 'Making PDF…' : 'Download PDF'}</button>;
  }
  const choose = (paper) => { setOpen(false); onDownload(paper); };
  return (
    <div className="org-download-wrap" ref={ref}>
      <button type="button" className="org-download" onClick={() => setOpen((o) => !o)} disabled={busy} aria-haspopup="menu" aria-expanded={open}>
        <Icon name="FileDown" size={16} /> {busy ? 'Making PDF…' : 'Download PDF'} <Icon name="ChevronDown" size={14} />
      </button>
      {open && (
        <div className="org-download-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => choose('FULL')}><b>Full size</b><small>One page with the whole chart. Zoom in to read.</small></button>
          <button type="button" role="menuitem" onClick={() => choose('A4')}><b>A4, ready to print</b><small>Big charts are split into teams, readable on paper.</small></button>
          <button type="button" role="menuitem" onClick={() => choose('A3')}><b>A3, ready to print</b><small>Bigger sheets, fewer pages.</small></button>
        </div>
      )}
    </div>
  );
}

export default function Hierarchy() {
  const { user } = useAuth();
  const canManageHierarchy = hasAbility(user, 'HIERARCHY', 'MANAGE');
  const { data, error, reload } = useApi('/hierarchy', []);
  const [submitError, setSubmitError] = useState(null);
  const [message, setMessage] = useState('');
  const [draggedId, setDraggedId] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [view, setView] = useState(() => {
    try { return window.localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'list'; } catch (_) { return 'list'; }
  });
  const [focusId, setFocusId] = useState('');
  const [highlight, setHighlight] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const allRoots = data?.tree || [];
  const index = useMemo(() => indexOrgForest(allRoots), [allRoots]);
  const all = useMemo(() => flatten(allRoots, []), [allRoots]);
  const colourOf = useMemo(() => departmentPalette(departmentsOf(allRoots)), [allRoots]);
  const focusNode = focusId ? index.byId.get(focusId) : null;
  const roots = useMemo(() => (focusNode ? [focusNode] : allRoots), [focusNode, allRoots]);
  const managers = useMemo(() => all.filter((p) => p.children?.length).sort((a, b) => nameOf(a).localeCompare(nameOf(b))), [all]);
  const unplaced = allRoots.filter((r) => !r.children?.length).length;
  const highlightId = highlight?.id || '';

  useEffect(() => { if (focusId && data && !focusNode) setFocusId(''); }, [focusId, focusNode, data]);
  useEffect(() => { try { window.localStorage.setItem(VIEW_KEY, view); } catch (_) { /* private mode */ } }, [view]);
  useEffect(() => {
    if (!highlight || view !== 'list') return undefined;
    const t = setTimeout(() => document.getElementById(`org-row-${highlight.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    return () => clearTimeout(t);
  }, [highlight, view]);
  useEffect(() => {
    if (!highlight) return undefined;
    const t = setTimeout(() => setHighlight((h) => (h === highlight ? null : h)), 6000);
    return () => clearTimeout(t);
  }, [highlight]);

  const toggle = useCallback((id) => setCollapsed((c) => ({ ...c, [id]: !c[id] })), []);
  function onDragStart(e, id) { setDraggedId(id); e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; }
  async function updateManager(employeeId, reportsTo) {
    if (!employeeId || employeeId === reportsTo) return;
    setSubmitError(null); setMessage('');
    try { await post('/hierarchy/manager', { employeeId, reportsTo: reportsTo || '' }); setMessage(reportsTo ? 'Reporting manager updated instantly.' : 'Employee moved to top level.'); reload(); } catch (err) { setSubmitError(err); }
  }
  function onDropNode(e, managerId) { e.preventDefault(); updateManager(draggedId || e.dataTransfer.getData('text/plain'), managerId); }
  function expandAll() { setCollapsed({}); }
  function collapseAll() { const next = {}; all.forEach((n) => { if (n.children?.length) next[n._id] = true; }); setCollapsed(next); }

  function reveal(id) {
    // Open every team above the person, and show the whole company if they are outside the team on screen.
    const above = [];
    for (let p = index.parentOf.get(id); p; p = index.parentOf.get(p)) above.push(p);
    if (focusId && id !== focusId && !above.includes(focusId)) setFocusId('');
    setCollapsed((c) => { const next = { ...c }; above.forEach((a) => { delete next[a]; }); return next; });
    setHighlight({ id, at: Date.now() });
  }

  async function downloadPdf(paper) {
    setDownloading(true); setSubmitError(null);
    try {
      const body = { view: view === 'tree' ? 'TREE' : 'LIST', paper, rootId: focusId || undefined, collapsed: Object.keys(collapsed).filter((id) => collapsed[id]) };
      const blob = await post('/hierarchy/chart.pdf', body, { loadingMessage: 'Making the PDF…', successMessage: 'Organisation chart PDF downloaded' });
      const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      const team = focusNode ? `-team-${nameOf(focusNode).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `organisation-chart${team}${view === 'list' ? '-list' : ''}-${day}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) { setSubmitError(err); } finally { setDownloading(false); }
  }

  const focusSize = focusNode ? (index.teamSize.get(focusId) || 0) + 1 : 0;

  return <div className="nexus-page hierarchy-v23 org-page">
    <ErrorBox error={error || submitError} />
    {message && <div className="org-message" role="status">{message}</div>}

    <section className="directory-hero premium-hero org-hero page-intro"><div><small>🏢 HR · Organisation</small><h1>Organisation chart</h1><p>Who reports to whom, as a list or as a tree. Download either one as a PDF.{canManageHierarchy ? ' To change someone’s manager, drag them in the list or use Quick change.' : ''}</p></div><div className="hero-actions"><button onClick={reload}>↻ Refresh</button></div></section>

    <div className={`org-layout${view === 'tree' ? ' is-tree' : ''}`}>
      <section className="org-shell" aria-label="Organisation chart">
        <div className="org-toolbar">
          <div className="org-seg" role="group" aria-label="View">
            <button type="button" className={view === 'list' ? 'is-on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="ListTree" size={15} /> List</button>
            <button type="button" className={view === 'tree' ? 'is-on' : ''} aria-pressed={view === 'tree'} onClick={() => setView('tree')}><Icon name="Network" size={15} /> Tree</button>
          </div>
          <PersonSearch people={all} onPick={reveal} />
          <label className="org-focus">
            <span>Show</span>
            <select value={focusId} onChange={(e) => setFocusId(e.target.value)} aria-label="Show the whole company or one team">
              <option value="">Whole company</option>
              {managers.map((m) => <option key={m._id} value={String(m._id)}>Team of {nameOf(m)}</option>)}
            </select>
          </label>
          <div className="org-tool-group">
            <button type="button" onClick={expandAll}>Expand all</button>
            <button type="button" onClick={collapseAll}>Collapse all</button>
          </div>
          <DownloadPdf view={view} busy={downloading} onDownload={downloadPdf} />
        </div>

        <div className="org-status">
          {focusNode
            ? <><b>Team of {nameOf(focusNode)}</b><span>{focusSize} {focusSize === 1 ? 'person' : 'people'}</span><button type="button" className="org-linkbtn" onClick={() => setFocusId('')}>Show whole company</button></>
            : <><span><b>{all.length}</b> people</span><span><b>{managers.length}</b> with a team</span>{unplaced > 0 && <span><b>{unplaced}</b> without a manager</span>}</>}
          {view === 'list' && <span className="org-status-hint">{canManageHierarchy ? 'Drag enabled' : 'Read only'}</span>}
        </div>

        {!allRoots.length ? <Empty /> : view === 'tree'
          ? <OrgTreeView roots={roots} collapsed={collapsed} onToggle={toggle} colourOf={colourOf} highlight={highlight} focusId={focusId} onFocus={setFocusId} separateUnplaced={!focusNode} />
          : <div className="org-list">
            {canManageHierarchy && <div className="drop-root" onDragOver={(e) => canManageHierarchy && e.preventDefault()} onDrop={(e) => { e.preventDefault(); updateManager(draggedId || e.dataTransfer.getData('text/plain'), ''); }}>Drop here to make top level</div>}
            <div className="tree-board">{roots.map((n) => <TreeNode key={n._id} node={n} collapsed={collapsed} toggle={toggle} onDragStart={onDragStart} onDropNode={onDropNode} canManage={canManageHierarchy} makeRoot={(id) => updateManager(id, '')} highlightId={highlightId} />)}</div>
          </div>}
      </section>
      <Card title="Quick Reporting Change">
        <p className="muted">Use dropdowns if drag-drop is not convenient.</p>
        <QuickChange employees={all} onSave={updateManager} canManage={canManageHierarchy} />
      </Card>
    </div>
  </div>;
}

function QuickChange({ employees, onSave, canManage }) {
  const [employeeId, setEmployeeId] = useState('');
  const [managerId, setManagerId] = useState('');
  return <div className="quick-change"><select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={!canManage}><option value="">Select employee</option>{employees.map((e) => <option key={e._id} value={e._id}>{e.employeeCode} · {nameOf(e)}</option>)}</select><select value={managerId} onChange={(e) => setManagerId(e.target.value)} disabled={!canManage}><option value="">Top level / no manager</option>{employees.filter((e) => e._id !== employeeId).map((e) => <option key={e._id} value={e._id}>{e.employeeCode} · {nameOf(e)}</option>)}</select><button className="yellow-btn" disabled={!canManage || !employeeId} onClick={() => onSave(employeeId, managerId)}>Update Reporting</button></div>;
}

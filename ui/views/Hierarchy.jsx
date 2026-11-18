import React, { useMemo, useState } from 'react';
import { Card, Empty, ErrorBox } from '../components/Ui.jsx';
import { post } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility } from '../utils/permissions.js';

function nameOf(node) { return `${node.firstName || ''} ${node.lastName || ''}`.trim() || node.employeeCode || 'Employee'; }
function initials(node) { return nameOf(node).split(' ').filter(Boolean).slice(0,2).map((p)=>p[0]).join('').toUpperCase() || 'E'; }

function TreeNode({ node, level = 0, collapsed, toggle, onDragStart, onDropNode, canManage, makeRoot }) {
  const isClosed = collapsed[node._id];
  const hasChildren = node.children?.length > 0;
  return <div className="tree-row-wrap">
    <div className={`tree-row level-${Math.min(level,4)}`} draggable={canManage} onDragStart={(e)=>onDragStart(e,node._id)} onDragOver={(e)=>canManage && e.preventDefault()} onDrop={(e)=>onDropNode(e,node._id)}>
      <button className="collapse-btn" onClick={()=>toggle(node._id)}>{hasChildren ? (isClosed ? '▸' : '▾') : '•'}</button>
      <span className="tree-avatar">{initials(node)}</span>
      <div className="tree-person"><strong>{nameOf(node)}</strong><small>{node.employeeCode} · {node.designation || 'Employee'} · {node.department || '-'}</small></div>
      <span className="count-pill">{node.children?.length || 0} reports</span>
      {canManage && <button className="tiny-btn" onClick={()=>makeRoot(node._id)}>Make top</button>}
    </div>
    {hasChildren && !isClosed && <div className="tree-children">{node.children.map((child)=><TreeNode key={child._id} node={child} level={level+1} collapsed={collapsed} toggle={toggle} onDragStart={onDragStart} onDropNode={onDropNode} canManage={canManage} makeRoot={makeRoot} />)}</div>}
  </div>;
}

function flatten(nodes = [], out = []) { nodes.forEach((n)=>{ out.push(n); flatten(n.children || [], out); }); return out; }

export default function Hierarchy() {
  const { user } = useAuth();
  const canManageHierarchy = hasAbility(user, 'HIERARCHY', 'MANAGE');
  const { data, error, reload } = useApi('/hierarchy', []);
  const [submitError, setSubmitError] = useState(null);
  const [message, setMessage] = useState('');
  const [draggedId, setDraggedId] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const roots = data?.tree || [];
  const all = useMemo(() => flatten(roots, []), [roots]);

  function toggle(id) { setCollapsed((c)=>({ ...c, [id]: !c[id] })); }
  function onDragStart(e, id) { setDraggedId(id); e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; }
  async function updateManager(employeeId, reportsTo) {
    if (!employeeId || employeeId === reportsTo) return;
    setSubmitError(null); setMessage('');
    try { await post('/hierarchy/manager', { employeeId, reportsTo: reportsTo || '' }); setMessage(reportsTo ? 'Reporting manager updated instantly.' : 'Employee moved to top level.'); reload(); } catch (err) { setSubmitError(err); }
  }
  function onDropNode(e, managerId) { e.preventDefault(); updateManager(draggedId || e.dataTransfer.getData('text/plain'), managerId); }
  function expandAll() { setCollapsed({}); }
  function collapseAll() { const next = {}; all.forEach((n)=>{ if (n.children?.length) next[n._id] = true; }); setCollapsed(next); }

  return <div className="nexus-page hierarchy-v23">
    <ErrorBox error={error || submitError} />
    
    <section className="directory-hero premium-hero org-hero page-intro"><div><small>🏢 HR · Organisation</small><h1>Drag & Drop Organization Hierarchy</h1><p>Who reports to whom. Drag a person onto their new manager to change it.</p></div><div className="hero-actions"><button onClick={expandAll}>Expand all</button><button onClick={collapseAll}>Collapse all</button><button onClick={reload}>↻ Refresh</button></div></section>
    <div className="org-layout">
      <Card title="Organization Tree" actions={<span className="muted small">{canManageHierarchy ? 'Drag enabled' : 'Read only'}</span>}>
        <div className="drop-root" onDragOver={(e)=>canManageHierarchy && e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); updateManager(draggedId || e.dataTransfer.getData('text/plain'), ''); }}>Drop here to make top level</div>
        {!roots.length ? <Empty /> : <div className="tree-board">{roots.map((n)=><TreeNode key={n._id} node={n} collapsed={collapsed} toggle={toggle} onDragStart={onDragStart} onDropNode={onDropNode} canManage={canManageHierarchy} makeRoot={(id)=>updateManager(id,'')} />)}</div>}
      </Card>
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
  return <div className="quick-change"><select value={employeeId} onChange={(e)=>setEmployeeId(e.target.value)} disabled={!canManage}><option value="">Select employee</option>{employees.map((e)=><option key={e._id} value={e._id}>{e.employeeCode} · {nameOf(e)}</option>)}</select><select value={managerId} onChange={(e)=>setManagerId(e.target.value)} disabled={!canManage}><option value="">Top level / no manager</option>{employees.filter((e)=>e._id!==employeeId).map((e)=><option key={e._id} value={e._id}>{e.employeeCode} · {nameOf(e)}</option>)}</select><button className="yellow-btn" disabled={!canManage || !employeeId} onClick={()=>onSave(employeeId, managerId)}>Update Reporting</button></div>;
}

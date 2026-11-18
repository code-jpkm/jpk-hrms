import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from '../lib/router.jsx';
import Icon from '../components/Icon.jsx';
import WidgetGrid from '../components/dashboard/WidgetGrid.jsx';
import GeminiStudio from '../components/dashboard/GeminiStudio.jsx';
import TodayStrip from '../components/dashboard/TodayStrip.jsx';
import { RouteSkeleton } from '../components/Loading.jsx';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { useDashboard } from '../hooks/useDashboard.js';
import { canCustomizeDashboard } from '../utils/permissions.js';

export default function Dashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const { data: summary } = useApi('/dashboard/summary', []);
  const { widgets, loading, add, remove, update, move, reset } = useDashboard(user, summary || {});
  const canEdit = canCustomizeDashboard(user);
  const [editing, setEditing] = useState(false);
  const [studio, setStudio] = useState(false);

  // The topbar's sparkle button opens /dashboard?studio=1 to start the AI studio.
  const navigate = useNavigate();
  useEffect(() => {
    if (!location.search.includes('studio=1')) return;
    if (canEdit) { setStudio(true); setEditing(true); }
    navigate('/dashboard', { replace: true, scroll: false });
  }, [location.search]);

  if (loading) {
    return <RouteSkeleton compact />;
  }

  return (
    <div className="dash">
      <div className="dash-bar">
        <div className="dash-title">
          <h1>Dashboard</h1>
          <p>{editing ? 'Drag to rearrange, resize, or remove. Changes save automatically.' : 'Your personalised workforce overview.'}</p>
        </div>
        {canEdit && (
          <div className="dash-tools">
            <button className="tool-btn ai" onClick={() => setStudio(true)}><Icon name="Sparkles" size={16} /> Create with Gemini</button>
            {editing && <button className="tool-btn ghost" onClick={reset}><Icon name="RefreshCw" size={15} /> Reset</button>}
            <button className={`tool-btn ${editing ? 'solid' : ''}`} onClick={() => setEditing((v) => !v)}>
              <Icon name={editing ? 'CheckCircle2' : 'Sliders'} size={15} /> {editing ? 'Done' : 'Customise'}
            </button>
          </div>
        )}
      </div>

      {!canEdit && (
        <div className="dash-note">
          <Icon name="ShieldCheck" size={16} />
          <span>This is a read-only view. Ask an administrator for dashboard-customise access to rearrange or add widgets.</span>
        </div>
      )}

      {!editing && <TodayStrip user={user} summary={summary || {}} />}

      <WidgetGrid
        widgets={widgets}
        editing={editing && canEdit}
        summary={summary || {}}
        onAdd={add}
        onRemove={remove}
        onUpdate={update}
        onMove={move}
      />

      <GeminiStudio
        open={studio}
        onClose={() => setStudio(false)}
        onCreate={(w) => { add(w); setEditing(true); }}
        summary={summary || {}}
      />
    </div>
  );
}

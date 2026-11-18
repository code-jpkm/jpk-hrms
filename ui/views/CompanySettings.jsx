import React, { useEffect, useState } from 'react';
import { Link } from '../lib/router.jsx';
import Icon from '../components/Icon.jsx';
import { api } from '../api/client.js';
import { Card, Empty, ErrorBox, Field, Table } from '../components/Ui.jsx';
import { hasAbility } from '../utils/permissions.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';

function blankSite() {
  return { name: '', type: 'OFFICE', lat: '', lng: '', radiusMeters: 250, address: '', active: true };
}

export default function CompanySettings() {
  const { user } = useAuth();
  const canManage = hasAbility(user, 'COMPANY_SETTINGS', 'MANAGE');
  const { data, error: loadError, reload } = useApi('/company-settings', []);
  const [sites, setSites] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (data?.tenant?.sites) setSites(data.tenant.sites.map((s) => ({ ...s })));
  }, [data]);

  function updateSite(index, key, value) {
    setSites((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  function addSite() {
    setSites((rows) => [...rows, blankSite()]);
  }

  function removeSite(index) {
    setSites((rows) => rows.filter((_, i) => i !== index));
  }

  async function save(e) {
    e.preventDefault();
    setError(null); setMessage('');
    try {
      const payload = {
        sites: sites.map((s) => ({
          name: s.name,
          type: s.type,
          lat: Number(s.lat),
          lng: Number(s.lng),
          radiusMeters: Number(s.radiusMeters || 250),
          address: s.address || '',
          active: s.active !== false
        }))
      };
      await api('/company-settings/geofence-sites', { method: 'PUT', body: JSON.stringify(payload) });
      setMessage('Geofence sites saved. Mobile attendance will use these office/factory locations.');
      reload();
    } catch (err) { setError(err); }
  }

  return (
    <div className="nexus-page settings-v23">
      <section className="directory-hero premium-hero page-intro"><div><small>COMPANY CONFIGURATION</small><h1>Company Settings</h1><p>Office and factory locations for mobile attendance, and other company-wide settings.</p></div></section>
      <ErrorBox error={error || loadError} />

      {canManage && <IntegrationsShortcut />}

      <Card title="Geofence sites for mobile attendance" actions={canManage && <button onClick={addSite}>Add site</button>}>
        <p className="muted small">Create office/factory geofence locations here. Employees with <strong>Geofencing enabled</strong> can mark mobile attendance only inside one active site radius. Employees with <strong>Anywhere attendance</strong> can mark attendance from any location.</p>
        {!sites.length ? <Empty>No office/factory sites configured yet.</Empty> : (
          <form onSubmit={save}>
            <div className="site-editor-list">
              {sites.map((site, index) => (
                <div className="site-editor-card" key={site._id || index}>
                  <div className="form-grid">
                    <Field label="Site name"><input value={site.name || ''} onChange={(e) => updateSite(index, 'name', e.target.value)} placeholder="Office / Factory" disabled={!canManage} required /></Field>
                    <Field label="Type"><select value={site.type || 'OFFICE'} onChange={(e) => updateSite(index, 'type', e.target.value)} disabled={!canManage}><option>OFFICE</option><option>FACTORY</option><option>OTHER</option></select></Field>
                    <Field label="Radius meters"><input type="number" value={site.radiusMeters || 250} onChange={(e) => updateSite(index, 'radiusMeters', e.target.value)} disabled={!canManage} required /></Field>
                    <Field label="Latitude"><input type="number" step="any" value={site.lat ?? ''} onChange={(e) => updateSite(index, 'lat', e.target.value)} disabled={!canManage} required /></Field>
                    <Field label="Longitude"><input type="number" step="any" value={site.lng ?? ''} onChange={(e) => updateSite(index, 'lng', e.target.value)} disabled={!canManage} required /></Field>
                    <Field label="Address / remarks"><input value={site.address || ''} onChange={(e) => updateSite(index, 'address', e.target.value)} disabled={!canManage} /></Field>
                  </div>
                  <div className="actions-row mini">
                    <label className="check"><input type="checkbox" checked={site.active !== false} onChange={(e) => updateSite(index, 'active', e.target.checked)} disabled={!canManage} /> Active</label>
                    {canManage && <button type="button" onClick={() => removeSite(index)}>Remove</button>}
                  </div>
                </div>
              ))}
            </div>
            {canManage && <button className="primary">Save geofence sites</button>}
          </form>
        )}
      </Card>

      <details className="premium-collapsible settings-data-collapsible">
        <summary><span><b>Technical geofence coordinates</b><small>Exact latitude, longitude and radius · hidden by default</small></span><em>{sites.length} site{sites.length === 1 ? '' : 's'}</em></summary>
        <div className="collapsible-body">
          {!sites.length ? <Empty /> : <Table columns={['Site', 'Type', 'Latitude', 'Longitude', 'Radius', 'Active']} rows={sites} renderRow={(s, i) => <tr key={s._id || i}><td>{s.name}</td><td>{s.type}</td><td>{s.lat}</td><td>{s.lng}</td><td>{s.radiusMeters} m</td><td>{s.active !== false ? 'Yes' : 'No'}</td></tr>} />}
        </div>
      </details>
    </div>
  );
}

/** Status of Email / WhatsApp / Gemini with a jump to the Integrations page. */
function IntegrationsShortcut() {
  const { data } = useApi('/integrations', []);
  const items = [
    { key: 'email', icon: 'Mail', label: 'Email', on: data?.email?.configured && data?.email?.enabled !== false, sub: data?.email?.configured ? (data.email.provider || 'Connected') : 'Not connected', tab: 'email' },
    { key: 'wa', icon: 'MessageCircle', label: 'WhatsApp', on: data?.whatsapp?.configured && data?.whatsapp?.enabled !== false, sub: data?.whatsapp?.configured ? (data.whatsapp.provider || 'Connected') : 'Not connected', tab: 'whatsapp' },
    { key: 'ai', icon: 'Sparkles', label: 'Gemini AI', on: data?.ai?.configured && data?.ai?.enabled !== false, sub: data?.ai?.configured ? (data.ai.model || 'Connected') : 'Add an API key', tab: 'ai' }
  ];
  return (
    <section className="settings-integrations">
      <div>
        <small>MESSAGING &amp; AI</small>
        <h3>Email, WhatsApp and Gemini</h3>
        <p>Payslips, leave decisions, notices, birthday wishes and reminders go out on the channels you connect here.</p>
      </div>
      <div className="settings-integrations-list">
        {items.map((i) => (
          <Link key={i.key} to={`/integrations#${i.tab}`} className={`settings-integration ${i.on ? 'on' : ''}`}>
            <Icon name={i.icon} size={17} />
            <span><b>{i.label}</b><small>{data ? i.sub : 'Checking…'}</small></span>
            <em>{data ? (i.on ? 'On' : 'Set up') : ''}</em>
          </Link>
        ))}
      </div>
    </section>
  );
}

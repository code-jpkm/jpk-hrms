import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { Card, Empty, ErrorBox, Field, Table } from '../components/Ui.jsx';
import { patch, post, remove } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility } from '../utils/permissions.js';
import '../styles/machines.css';

// ---------------------------------------------------------------------------
// Attendance machines: eSSL / ZKTeco machines in "ADMS / Cloud Server" mode send
// every punch to the HRMS by themselves. HR only approves the machine and links
// machine IDs to people. The old bridge software stays available further down.

const IST = 'Asia/Kolkata';
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date());
const whenFormat = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const when = (value) => (value ? whenFormat.format(new Date(value)).replace(/\b(am|pm)\b/i, (m) => m.toLowerCase()) : '—');
function ago(value) {
  if (!value) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return when(value);
}
const VERIFY = { 1: 'Finger', 15: 'Face', 4: 'Card', 3: 'Password', 0: 'Password', 25: 'Palm', 2: 'Card' };

function copy(text) {
  try { navigator.clipboard.writeText(String(text)); } catch { /* clipboard not allowed */ }
}

function downloadText(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function startRelayBat(appUrl) {
  return [
    '@echo off',
    'title JPK attendance relay - keep this window open',
    `set APP_URL=${appUrl}`,
    'cd /d "%~dp0"',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo.',
    '  echo   Node.js is not installed on this computer.',
    '  echo   Install the LTS version from https://nodejs.org and run this again.',
    '  echo.',
    '  pause',
    '  exit /b 1',
    ')',
    'node attendance-relay.js',
    'pause',
    ''
  ].join('\r\n');
}

export default function Biometric() {
  const { user } = useAuth();
  const canManage = hasAbility(user, 'BIOMETRIC', 'MANAGE');
  const canSync = hasAbility(user, 'BIOMETRIC', 'SYNC');
  const { data, error, reload } = useApi('/biometric/machines', [], { skeleton: false });
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  // Live page: the machine checks in every half minute, punches arrive within seconds.
  useEffect(() => {
    const tick = () => { if (!document.hidden) reload(); };
    const id = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [reload]);

  const machines = data?.machines || [];
  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.people || []).filter((p) => !q || [p.pin, p.nameOnMachine, p.employee?.name, p.employee?.employeeCode].join(' ').toLowerCase().includes(q));
  }, [data, query]);
  const waitingIds = (data?.people || []).filter((p) => !p.employee && p.punches > 0).length;
  const suggested = (data?.people || []).filter((p) => !p.employee && p.suggestion);
  const [linkingAll, setLinkingAll] = useState(false);

  async function linkAllSuggested() {
    setLinkingAll(true);
    try {
      for (const p of suggested) {
        await post('/biometric/machines/link', { pin: p.pin, employeeId: p.suggestion._id }, { toast: false });
      }
      await post('/biometric/machines/process', {}, { loadingMessage: 'Adding their punches…', successMessage: `${suggested.length} machine IDs linked` });
    } catch { /* the toast explains */ } finally {
      setLinkingAll(false);
      reload();
    }
  }

  async function processNow() {
    const r = await post('/biometric/machines/process', {}, { loadingMessage: 'Adding punches to attendance…', successMessage: 'Punches added to attendance' }).catch(() => null);
    if (r) reload();
  }

  return (
    <div className="nexus-page machines-page">
      <section className="directory-hero premium-hero page-intro">
        <div>
          <small>ATTENDANCE MACHINES</small>
          <h1>Attendance machines</h1>
          <p>Fingerprint and face machines send each punch here by themselves. The first punch of the day is the check-in, the last is the check-out.</p>
        </div>
        <div className="hero-actions">
          <button type="button" onClick={reload}><Icon name="RefreshCw" size={15} /> Refresh</button>
          {canManage && machines.length > 0 && (
            <button type="button" className="primary" onClick={() => setAdding((v) => !v)}><Icon name="Plus" size={15} /> Add machine</button>
          )}
        </div>
      </section>
      <ErrorBox error={error} />

      {data?.pending > 0 && (
        <div className="mc-banner">
          <Icon name="Clock" size={16} />
          <span><b>{data.pending} punch{data.pending === 1 ? '' : 'es'}</b> being added to attendance. This finishes by itself in a few seconds.</span>
          {canSync && <button type="button" onClick={processNow}>Add them now</button>}
        </div>
      )}

      {data && !machines.length && (
        <Card title="Add your attendance machine" className="mc-setup-card">
          <div className="mc-big-steps">
            <section>
              <h3><span>1</span> Add the machine here</h3>
              {canManage
                ? <AddMachineForm onAdded={reload} />
                : <p className="mc-muted">Ask HR or an admin to add the machine.</p>}
            </section>
            <section>
              <h3><span>2</span> Connect the machine</h3>
              <Setup connect={data.connect} lettered />
            </section>
          </div>
        </Card>
      )}

      {adding && machines.length > 0 && (
        <Card title="Add another machine" className="mc-setup-card" actions={<button type="button" onClick={() => setAdding(false)}><Icon name="X" size={15} /> Close</button>}>
          <AddMachineForm onAdded={() => { setAdding(false); reload(); }} />
        </Card>
      )}

      {machines.map((m) => <MachineCard key={m._id} m={m} connect={data.connect} canManage={canManage} onChanged={reload} />)}

      {machines.length > 0 && (
        <details className="mc-more">
          <summary><Icon name="CircleHelp" size={15} /> How to connect a machine</summary>
          <div className="mc-more-body"><Setup connect={data.connect} /></div>
        </details>
      )}

      {machines.length > 0 && (
        <Card
          title="People on the machine"
          className="mc-people-card"
          actions={<label className="mc-search"><Icon name="Search" size={14} /><input placeholder="Search ID or name" value={query} onChange={(e) => setQuery(e.target.value)} /></label>}
        >
          <div className="mc-note-row">
            <p className={`mc-note ${waitingIds ? 'warn' : ''}`}>
              {waitingIds
                ? <><b>{waitingIds} machine ID{waitingIds === 1 ? '' : 's'} not linked</b> to anyone. Their punches are kept and added as soon as you pick the person.</>
                : 'Every machine ID that punched is linked to a person.'}
            </p>
            {canManage && suggested.length > 1 && (
              <button type="button" disabled={linkingAll} onClick={linkAllSuggested}><Icon name="Link2" size={15} /> Link {suggested.length} suggested</button>
            )}
          </div>
          {!people.length ? <Empty>People appear here after their first punch, or when the machine sends its user list.</Empty> : (
            <div className="mc-people" role="table">
              <div className="mc-row mc-head" role="row"><span>Machine ID</span><span>Name on machine</span><span>Employee</span><span>Punches (90 days)</span><span>Last punch</span></div>
              {people.map((p) => <PersonRow key={p.pin} p={p} employees={data.employees} canManage={canManage} onChanged={reload} />)}
            </div>
          )}
          <p className="mc-hint">Linking a machine ID adds its punches to that person's attendance straight away. If it was linked to someone else before, those days move to the right person. The ID is also saved as the employee's Device User ID.</p>
        </Card>
      )}

      {machines.length > 0 && (
        <Card title="Latest punches" className="mc-punch-card" actions={<span className="mc-muted">{data.todayCount} today</span>}>
          {!data.recent?.length ? <Empty>Punch on the machine — it shows here within seconds.</Empty> : (
            <div className="mc-punches">
              {data.recent.map((p) => (
                <div className="mc-punch" key={p._id}>
                  <span className={`mc-avatar ${p.employee ? '' : 'anon'}`}>{p.employee ? initials(p.employee.name) : p.pin}</span>
                  <div className="mc-punch-main">
                    <b>{p.employee ? p.employee.name : `Machine ID ${p.pin}`}</b>
                    <small>{when(p.at)}{VERIFY[p.verify] ? ` · ${VERIFY[p.verify]}` : ''} · {p.machine}{p.receivedAt && new Date(p.receivedAt) - new Date(p.at) > 10 * 60000 ? ` · arrived ${ago(p.receivedAt)}` : ''}</small>
                  </div>
                  <span className={`mc-chip ${p.tone}`}>{p.label}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <details className="premium-collapsible mc-legacy">
        <summary><span><b>Older way: bridge software on a computer</b><small>Only needed for machines without ADMS / Cloud Server</small></span></summary>
        <div className="collapsible-body"><BridgeSetup canManage={canManage} canSync={canSync} /></div>
      </details>
    </div>
  );
}

const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

// ---------------------------------------------------------------------------

function MachineCard({ m, connect, canManage, onChanged }) {
  const [name, setName] = useState(m.name || '');
  const [location, setLocation] = useState(m.locationName || '');
  const [from, setFrom] = useState(m.importFrom || todayKey());
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(m.name || ''); setLocation(m.locationName || ''); setFrom(m.importFrom || todayKey()); }, [m.name, m.locationName, m.importFrom]);
  const dirty = m.approved && (name !== (m.name || '') || location !== (m.locationName || '') || from !== (m.importFrom || ''));

  async function run(fn) {
    setBusy(true);
    try { await fn(); onChanged(); } catch { /* the toast explains */ } finally { setBusy(false); }
  }
  const approve = () => run(() => post(`/biometric/machines/${m._id}/approve`, { name, locationName: location, importFrom: from }, { loadingMessage: 'Approving machine…', successMessage: 'Machine approved. Its punches now count as attendance.' }));
  const save = () => run(() => patch(`/biometric/machines/${m._id}`, { name, locationName: location, importFrom: from }, { successMessage: 'Saved' }));
  const stop = () => { if (window.confirm(`Stop using ${m.name}? Its new punches will be kept but not added to attendance.`)) run(() => post(`/biometric/machines/${m._id}/stop`, {}, { successMessage: 'Machine stopped' })); };
  const drop = () => { if (window.confirm('Remove this machine and the punches it sent? Use this only if the machine is not yours.')) run(() => remove(`/biometric/machines/${m._id}`, { successMessage: 'Machine removed' })); };

  return (
    <section className={`mc-card ${m.approved ? '' : 'is-waiting'}`}>
      <header className="mc-card-head">
        <span className="mc-icon"><Icon name="Fingerprint" size={20} /></span>
        <div className="mc-title">
          <h3>{m.name || 'Attendance machine'}</h3>
          <small>Serial {m.serialNumber} · {m.locationName}</small>
        </div>
        <span className={`mc-online ${m.online ? 'on' : ''}`}>
          <Icon name={m.online ? 'Wifi' : 'WifiOff'} size={14} />
          {m.online ? 'Connected' : m.lastSeenAt ? `Last contact ${ago(m.lastSeenAt)}` : 'Not connected yet'}
        </span>
        {m.approved ? <span className="mc-chip ok"><Icon name="ShieldCheck" size={13} /> Approved</span> : <span className="mc-chip warn">Waiting for approval</span>}
      </header>

      {m.approved && !m.lastSeenAt && (
        <div className="mc-wait-connect">
          <div className="mc-alert">
            <Icon name="Clock" size={16} />
            <div><b>Added. Waiting for the machine to connect.</b> Set it up as below and restart it. This card shows <b>Connected</b> within a minute and every punch from then on counts.</div>
          </div>
          <details open={false}>
            <summary>Show how to connect it</summary>
            <Setup connect={connect} lettered />
          </details>
        </div>
      )}
      {!m.approved && (
        <div className="mc-alert">
          <Icon name="CircleAlert" size={16} />
          <div><b>This machine is asking to send attendance.</b> Check that the serial number matches the machine (Menu → System Info → Device Info), then approve it. Its punches are kept until then.</div>
        </div>
      )}
      {m.approved && m.clockOffsetMinutes > 0 && (
        <div className="mc-alert warn">
          <Icon name="Clock" size={16} />
          <div><b>The machine's clock is {Math.floor(m.clockOffsetMinutes / 60)} h {m.clockOffsetMinutes % 60} min behind India time.</b> New punches are corrected automatically. Set the right date and time on the machine (Menu → System → Date Time).</div>
        </div>
      )}

      <div className="mc-fields">
        <Field label="Name"><input value={name} placeholder="e.g. Office entrance" onChange={(e) => setName(e.target.value)} disabled={!canManage} /></Field>
        <Field label="Location">
          <input value={location} list="mc-locations" onChange={(e) => setLocation(e.target.value)} disabled={!canManage} />
        </Field>
        <Field label="Count punches from" hint="Older punches are kept but not added">
          <input type="date" value={from} max={todayKey()} onChange={(e) => setFrom(e.target.value)} disabled={!canManage} />
        </Field>
      </div>
      <datalist id="mc-locations"><option value="Office" /><option value="Factory" /></datalist>

      <div className="mc-facts">
        <span><b>{m.totalPunches || 0}</b>punches received</span>
        <span><b>{when(m.lastPunchAt)}</b>latest punch</span>
        <span><b>{m.peopleOnMachine || '—'}</b>people on machine</span>
        <span><b>{m.lastIp || '—'}</b>connects from</span>
      </div>

      {canManage && (
        <footer className="mc-actions">
          {!m.approved ? (
            <>
              <button type="button" className="primary" disabled={busy} onClick={approve}><Icon name="CheckCircle2" size={15} /> Approve machine</button>
              <button type="button" disabled={busy} onClick={drop}><Icon name="Trash2" size={15} /> Not ours, remove</button>
            </>
          ) : (
            <>
              {dirty && <button type="button" className="primary" disabled={busy} onClick={save}><Icon name="Save" size={15} /> Save changes</button>}
              <button type="button" disabled={busy} onClick={stop}><Icon name="Ban" size={15} /> Stop using this machine</button>
            </>
          )}
          {m.firmware && <small className="mc-muted">Firmware {m.firmware}</small>}
        </footer>
      )}
    </section>
  );
}

function PersonRow({ p, employees, canManage, onChanged }) {
  const [busy, setBusy] = useState(false);
  async function link(employeeId) {
    setBusy(true);
    try {
      await post('/biometric/machines/link', { pin: p.pin, employeeId: employeeId || null }, {
        loadingMessage: employeeId ? 'Linking and adding punches…' : 'Unlinking…',
        successMessage: employeeId ? `Machine ID ${p.pin} linked` : `Machine ID ${p.pin} unlinked`
      });
      onChanged();
    } catch { /* the toast explains */ } finally { setBusy(false); }
  }
  return (
    <div className={`mc-row ${p.employee ? '' : 'open'}`} role="row">
      <span className="mc-pin">{p.pin}</span>
      <span className="mc-muted">{p.nameOnMachine || '—'}</span>
      <span className="mc-link">
        <select value={p.employee?._id || ''} disabled={!canManage || busy} onChange={(e) => link(e.target.value)} aria-label={`Employee for machine ID ${p.pin}`}>
          <option value="">— Not linked —</option>
          {employees.map((e) => (
            <option key={e._id} value={e._id}>{e.name} · {e.employeeCode}{e.machineId && e.machineId !== p.pin ? ` (has ID ${e.machineId})` : ''}</option>
          ))}
        </select>
        {p.employee?.how === 'MATCHED' && <small>Matched by employee code</small>}
        {!p.employee && p.suggestion && canManage && (
          <button type="button" className="mc-suggest" disabled={busy} onClick={() => link(p.suggestion._id)}>
            <Icon name="Link2" size={13} /> Link to {p.suggestion.name} · {p.suggestion.employeeCode}?
          </button>
        )}
      </span>
      <span className="mc-muted">{p.punches}{p.notLinked > 0 && <em className="mc-wait"> · {p.notLinked} waiting</em>}</span>
      <span className="mc-muted">{when(p.lastAt)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AddMachineForm({ onAdded }) {
  const [form, setForm] = useState({ serialNumber: '', name: '', locationName: 'Office', importFrom: todayKey() });
  const [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/biometric/machines', form, { loadingMessage: 'Adding machine…', successMessage: 'Machine added. Now connect it.' });
      setForm({ serialNumber: '', name: '', locationName: 'Office', importFrom: todayKey() });
      onAdded();
    } catch { /* the toast explains */ } finally { setBusy(false); }
  }
  return (
    <form className="mc-add" onSubmit={submit}>
      <div className="mc-where">
        <Icon name="Info" size={16} />
        <span>Find the <b>serial number</b> on the machine: press <b>M/OK</b> → <b>System Info</b> → <b>Device Info</b> → <b>Serial No.</b> It is also on the sticker at the back of the machine.</span>
      </div>
      <div className="mc-add-grid">
        <Field label="Serial number *">
          <input value={form.serialNumber} required autoComplete="off" spellCheck={false} placeholder="e.g. CQZ7232460123" onChange={(e) => set('serialNumber', e.target.value.toUpperCase().replace(/\s+/g, ''))} />
        </Field>
        <Field label="Name"><input value={form.name} placeholder="e.g. Office entrance" onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Location"><input value={form.locationName} list="mc-locations" onChange={(e) => set('locationName', e.target.value)} /></Field>
        <Field label="Count punches from" hint="Older punches on the machine are kept but not added">
          <input type="date" value={form.importFrom} max={todayKey()} onChange={(e) => set('importFrom', e.target.value)} />
        </Field>
      </div>
      <datalist id="mc-locations"><option value="Office" /><option value="Factory" /></datalist>
      <div className="mc-actions">
        <button type="submit" className="primary" disabled={busy || form.serialNumber.length < 5}><Icon name="Plus" size={15} /> Add machine</button>
      </div>
    </form>
  );
}

function ValueRow({ k, v, copyable }) {
  return (
    <div className="mc-kv">
      <span>{k}</span>
      <b>{v}</b>
      {copyable ? <button type="button" className="mc-copy" onClick={() => copy(v)} aria-label={`Copy ${k}`} title="Copy"><Icon name="Copy" size={13} /></button> : <i />}
    </div>
  );
}

function Setup({ connect = {}, lettered = false }) {
  const ways = [
    connect.relayHost && { id: 'cloud', icon: 'Cloud', label: 'Through the punch relay', hint: 'No computer needed' },
    { id: 'office', icon: 'Monitor', label: 'Through an office computer', hint: 'Works with every machine' },
    { id: 'direct', icon: 'Globe', label: 'Straight to the HRMS', hint: 'Only if the machine supports https' }
  ].filter(Boolean);
  const [way, setWay] = useState(ways[0].id);

  return (
    <div className="mc-setup">
      <p className="mc-lead">No software on the machine and no device IDs or tokens. Type a few values into the machine and it starts sending punches here.</p>
      <div className="mc-ways" role="tablist">
        {ways.map((w) => (
          <button key={w.id} type="button" role="tab" aria-selected={way === w.id} className={way === w.id ? 'active' : ''} onClick={() => setWay(w.id)}>
            <Icon name={w.icon} size={16} />
            <span><b>{w.label}</b><small>{w.hint}</small></span>
          </button>
        ))}
      </div>

      {way === 'office' && (
        <ol className={`mc-steps ${lettered ? 'lettered' : ''}`}>
          <li>
            <h4>Start the relay on a computer that stays on</h4>
            <p>Any Windows computer in the same network as the machine, with <a href="https://nodejs.org" target="_blank" rel="noreferrer">Node.js</a> installed. Save both files in one folder and double-click <b>start-relay.bat</b>. Keep its window open. It shows the address to type into the machine.</p>
            <div className="mc-downloads">
              <a className="mc-btn" href="/downloads/attendance-relay.js" download="attendance-relay.js"><Icon name="Download" size={15} /> attendance-relay.js</a>
              <button type="button" className="mc-btn" onClick={() => downloadText('start-relay.bat', startRelayBat(connect.appUrl))}><Icon name="Download" size={15} /> start-relay.bat</button>
            </div>
            <small className="mc-muted">If the browser warns about the .bat file, choose Keep. It only starts the relay for {connect.appUrl}.</small>
          </li>
          <li>
            <h4>On the machine: Menu → COMM → Cloud Server Setting</h4>
            <div className="mc-kvs">
              <ValueRow k="Server Mode" v="ADMS" />
              <ValueRow k="Enable Domain Name" v="OFF" />
              <ValueRow k="Server Address" v="the computer's IP (shown in the relay window)" />
              <ValueRow k="Server Port" v={String(connect.officeRelayPort || 8081)} />
              <ValueRow k="Enable Proxy Server" v="OFF" />
            </div>
            <small className="mc-muted">The machine and the computer must be in the same network, e.g. machine 192.168.1.10 and computer 192.168.1.100.</small>
          </li>
          <li>
            <h4>Restart the machine</h4>
            <p>Within a minute it shows <b>Connected</b> on this page. A machine you did not add first shows here too: check its serial number and press <b>Approve</b>.</p>
          </li>
        </ol>
      )}

      {(way === 'direct' || way === 'cloud') && (
        <ol className={`mc-steps ${lettered ? 'lettered' : ''}`}>
          <li>
            <h4>On the machine: Menu → COMM → Ethernet</h4>
            <div className="mc-kvs">
              <ValueRow k="Subnet Mask" v="255.255.255.0" />
              <ValueRow k="Gateway" v="your internet router, usually 192.168.1.1" />
              <ValueRow k="DNS" v="8.8.8.8" />
            </div>
          </li>
          <li>
            <h4>Menu → COMM → Cloud Server Setting</h4>
            <div className="mc-kvs">
              <ValueRow k="Server Mode" v="ADMS" />
              <ValueRow k="Enable Domain Name" v="ON" />
              <ValueRow k="Server Address" v={way === 'cloud' ? connect.relayHost : connect.host} copyable />
              <ValueRow k="Server Port" v={String(way === 'cloud' ? connect.relayPort : connect.port)} />
              <ValueRow k="Enable Proxy Server" v="OFF" />
            </div>
          </li>
          <li>
            <h4>Restart the machine</h4>
            <p>Within a minute it shows <b>Connected</b> on this page. A machine you did not add first shows here too: check its serial number and press <b>Approve</b>.</p>
            {way === 'direct' && <p className="mc-muted">Not showing up after two minutes? Most machines can only send plain http. Use <b>Through an office computer</b> instead.</p>}
          </li>
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Older way: bridge software on a computer reads the machine and pushes punches.

const defaultDeviceForm = {
  name: 'Factory ESSL',
  vendor: 'ESSL',
  deviceId: 'FACTORY-ZK-01',
  locationName: 'Factory',
  ip: '192.168.1.201',
  port: 4370,
  mode: 'PUSH',
  apiUrl: '',
  apiToken: 'factory_device_token',
  syncEveryMinutes: 5,
  timezoneOffsetMinutes: 330,
  enabled: true,
  notes: ''
};

const cleanDevicePayload = (form) => ({
  ...form,
  port: Number(form.port || 4370),
  syncEveryMinutes: Number(form.syncEveryMinutes || 5),
  timezoneOffsetMinutes: Number(form.timezoneOffsetMinutes || 330),
  enabled: Boolean(form.enabled)
});

function BridgeSetup({ canManage, canSync }) {
  const { data: devices, error: devicesError, reload: reloadDevices } = useApi('/biometric/devices', []);
  const { data: punches, error: punchesError, reload: reloadPunches } = useApi('/biometric/raw-punches?limit=100', []);
  const [form, setForm] = useState(defaultDeviceForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  function editDevice(device) {
    setError(null);
    setMessage(`Editing ${device.name}.`);
    setEditingId(device._id);
    setForm({
      name: device.name || '', vendor: device.vendor || 'ESSL', deviceId: device.deviceId || '', locationName: device.locationName || '',
      ip: device.ip || '', port: device.port || 4370, mode: device.mode || 'PUSH', apiUrl: device.apiUrl || '', apiToken: device.apiToken || '',
      syncEveryMinutes: device.syncEveryMinutes || 5, timezoneOffsetMinutes: device.timezoneOffsetMinutes ?? 330, enabled: device.enabled !== false, notes: device.notes || ''
    });
  }

  async function saveDevice(e) {
    e.preventDefault();
    setError(null);
    setMessage('');
    try {
      const payload = cleanDevicePayload(form);
      if (editingId) await patch(`/biometric/devices/${editingId}`, payload);
      else await post('/biometric/devices', payload);
      setMessage(editingId ? `${payload.name} updated. If you changed the API token, update HRMS_PUSH_TOKEN in the bridge .env too.` : 'Device saved. Now run the matching bridge on that computer.');
      reloadDevices();
      if (!editingId) setForm(defaultDeviceForm);
      setEditingId(null);
    } catch (err) { setError(err); }
  }

  async function action(fn, done) {
    setError(null);
    setMessage('');
    try { const res = await fn(); setMessage(done(res)); reloadDevices(); reloadPunches(); } catch (err) { setError(err); }
  }

  return (
    <div className="mc-legacy-body">
      <p className="muted">Use this only for a machine that has no ADMS / Cloud Server menu. A bridge program on a computer reads the machine and sends punches every 5 minutes. The API token here must match <b>HRMS_PUSH_TOKEN</b> in that bridge's .env file.</p>
      <ErrorBox error={error || devicesError || punchesError} />
      {message && <p className="mc-note">{message}</p>}
      {canManage && (
        <form className="form-grid" onSubmit={saveDevice}>
          <Field label="Name"><input value={form.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          <Field label="Device ID"><input value={form.deviceId} onChange={(e) => set('deviceId', e.target.value)} required placeholder="FACTORY-ZK-01 / OFFICE-ZK-01" /></Field>
          <Field label="Location"><input value={form.locationName} onChange={(e) => set('locationName', e.target.value)} required /></Field>
          <Field label="Vendor"><select value={form.vendor} onChange={(e) => set('vendor', e.target.value)}><option>ESSL</option><option>ZKTECO</option><option>OTHER</option></select></Field>
          <Field label="Mode"><select value={form.mode} onChange={(e) => set('mode', e.target.value)}><option>PUSH</option><option>HTTP_PULL</option><option>ZKTECO_DIRECT</option><option>MANUAL_JSON</option><option>MOCK</option></select></Field>
          <Field label="Machine IP"><input value={form.ip} onChange={(e) => set('ip', e.target.value)} /></Field>
          <Field label="Port"><input type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} /></Field>
          <Field label="API URL"><input value={form.apiUrl} onChange={(e) => set('apiUrl', e.target.value)} placeholder={form.mode === 'PUSH' ? 'Not needed in PUSH mode' : 'http://BRIDGE-IP:8090/attendance'} /></Field>
          <Field label="API token (HRMS_PUSH_TOKEN)"><input value={form.apiToken} onChange={(e) => set('apiToken', e.target.value)} required={form.mode === 'PUSH'} /></Field>
          <Field label="Sync minutes"><input type="number" min="1" value={form.syncEveryMinutes} onChange={(e) => set('syncEveryMinutes', Number(e.target.value))} /></Field>
          <Field label="Time zone offset (minutes)"><input type="number" value={form.timezoneOffsetMinutes} onChange={(e) => set('timezoneOffsetMinutes', Number(e.target.value))} /></Field>
          <Field label="Notes"><input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <label className="check"><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Enabled</label>
          <div className="row-actions">
            <button className="primary">{editingId ? 'Update device' : 'Save device'}</button>
            {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(defaultDeviceForm); }}>Cancel</button>}
          </div>
        </form>
      )}
      <h4 className="mc-subhead">Bridge devices</h4>
      {!devices?.devices?.length ? <Empty>No bridge devices.</Empty> : (
        <Table columns={['Name', 'Device', 'Location', 'Mode', 'Status', 'Last sync', 'Imported', 'Action']} rows={devices.devices} renderRow={(d) => (
          <tr key={d._id}>
            <td>{d.name}</td><td>{d.deviceId}</td><td>{d.locationName}</td><td>{d.mode}</td><td>{d.status}{d.lastError ? `: ${d.lastError}` : ''}</td>
            <td>{d.lastSyncAt ? when(d.lastSyncAt) : '—'}</td><td>{d.lastImportedCount || 0}</td>
            <td className="row-actions">
              {canManage && <button type="button" onClick={() => editDevice(d)}>Edit</button>}
              {canSync && <button type="button" onClick={() => action(() => post(`/biometric/devices/${d._id}/test`, {}), (r) => `${r.message || 'Tested'} · sample punches: ${r.sampleCount ?? 0}`)}>Test</button>}
              {canSync && d.mode !== 'PUSH' && <button type="button" onClick={() => action(() => post(`/biometric/devices/${d._id}/sync`, {}), (r) => `Imported ${r.result?.imported || 0} punch(es).`)}>Sync</button>}
              {canManage && <button type="button" onClick={() => action(() => patch(`/biometric/devices/${d._id}`, { enabled: !d.enabled }), () => `${d.name} ${d.enabled ? 'disabled' : 'enabled'}.`)}>{d.enabled ? 'Disable' : 'Enable'}</button>}
            </td>
          </tr>
        )} />
      )}
      <details className="mc-audit">
        <summary>Raw punch log (technical) · {punches?.punches?.length || 0} recent</summary>
        {!punches?.punches?.length ? <Empty /> : (
          <Table columns={['Time', 'Device', 'Location', 'Employee', 'Added', 'Reason']} rows={punches.punches} renderRow={(p) => (
            <tr key={p._id}><td>{when(p.timestamp)}</td><td>{p.deviceId}</td><td>{p.locationName}</td><td>{p.employeeId?.employeeCode || p.employeeCode || p.deviceUserId}</td><td>{p.imported ? 'Yes' : 'No'}</td><td>{p.skippedReason || '—'}</td></tr>
          )} />
        )}
      </details>
    </div>
  );
}

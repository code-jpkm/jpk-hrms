import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Icon from '../../components/Icon.jsx';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { monthLabel, formatPunch, formatTime, formatDayKey } from '../../utils/time.js';

const PLACES = { ALL: 'Office and factory', OFFICE: 'Office', FACTORY: 'Factory' };

/** Saves a file the API sent (Excel or PDF). */
async function downloadFile(path, filename) {
  const toastId = toast.loading('Preparing the file…');
  try {
    const blob = await api(path);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast.success(`${filename} downloaded`, { id: toastId });
  } catch (err) {
    toast.error(err.message || 'Could not make the file', { id: toastId });
  }
}

function minutesText(minutes) {
  const total = Math.round(Number(minutes) * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/**
 * Reports tab: the month for everyone, and who left before their shift ended,
 * as Excel and PDF. Uses the month and Office / Factory chosen on the page.
 */
export default function Reports({ month, place }) {
  const [minMinutes, setMinMinutes] = useState(5);
  const [minTimes, setMinTimes] = useState(3);
  // Typing in the boxes waits a moment before asking the server again.
  const [criteria, setCriteria] = useState({ minMinutes: 5, minTimes: 3 });
  useEffect(() => {
    const t = setTimeout(() => setCriteria({ minMinutes: Math.max(0, Number(minMinutes) || 0), minTimes: Math.max(1, Math.round(Number(minTimes) || 1)) }), 450);
    return () => clearTimeout(t);
  }, [minMinutes, minTimes]);
  const [open, setOpen] = useState(null);

  const base = `month=${month}&location=${place}`;
  const earlyQuery = `${base}&minMinutes=${criteria.minMinutes}&minTimes=${criteria.minTimes}`;
  const earlyPath = `/attendance/reports/early-leave?${earlyQuery}`;
  const { data, loading, error } = useApi(earlyPath, [earlyPath], { skeleton: false });
  const people = data?.people || [];
  const suffix = place !== 'ALL' ? `-${place.toLowerCase()}` : '';
  const placeName = PLACES[place] || PLACES.ALL;

  return (
    <div className="att-reports">
      <section className="att-report-card">
        <div className="att-report-head">
          <span className="att-report-icon"><Icon name="CalendarRange" size={18} /></span>
          <div>
            <h3>Attendance report · {monthLabel(month)}</h3>
            <p>{placeName}. One row per person with every day (P, A, L, H, WO…) and the totals: present, half days, absent, leave, holidays, late, left early, out time missing, LOP days and hours worked. The Excel file also has a sheet with each day's in and out time, and where each phone punch was made (click to open Google Maps).</p>
          </div>
        </div>
        <div className="att-report-actions">
          <button type="button" className="att-btn" onClick={() => downloadFile(`/attendance/reports/monthly?${base}&format=xlsx`, `attendance-report-${month}${suffix}.xlsx`)}><Icon name="FileSpreadsheet" size={16} /> Download Excel</button>
          <button type="button" className="att-btn secondary" onClick={() => downloadFile(`/attendance/reports/monthly?${base}&format=pdf`, `attendance-report-${month}${suffix}.pdf`)}><Icon name="FileText" size={16} /> Download PDF</button>
        </div>
      </section>

      <section className="att-report-card">
        <div className="att-report-head">
          <span className="att-report-icon warn"><Icon name="LogOut" size={18} /></span>
          <div>
            <h3>Left before the shift ended · {monthLabel(month)}</h3>
            <p>{placeName}. People who left more than the minutes below before their shift's end time, at least the number of times below, with each day. Leave, WFH, holidays, weekly offs and days with a missing out time are not counted.</p>
          </div>
        </div>
        <div className="att-report-filters">
          <label>More than <input type="number" min="0" max="240" value={minMinutes} onChange={(e) => setMinMinutes(e.target.value)} /> minutes early</label>
          <label>at least <input type="number" min="1" max="31" value={minTimes} onChange={(e) => setMinTimes(e.target.value)} /> times{Number(minTimes) === 3 ? ' (more than 2)' : ''}</label>
        </div>
        <div className="att-report-actions">
          <button type="button" className="att-btn" onClick={() => downloadFile(`/attendance/reports/early-leave?${earlyQuery}&format=xlsx`, `left-early-${month}${suffix}.xlsx`)}><Icon name="FileSpreadsheet" size={16} /> Download Excel</button>
          <button type="button" className="att-btn secondary" onClick={() => downloadFile(`/attendance/reports/early-leave?${earlyQuery}&format=pdf`, `left-early-${month}${suffix}.pdf`)}><Icon name="FileText" size={16} /> Download PDF</button>
        </div>

        {error && <div className="att-alert"><Icon name="TriangleAlert" size={16} /><div>{error.message}</div></div>}
        {loading && !data ? (
          <div className="att-skeleton" style={{ minHeight: 120 }} />
        ) : !people.length ? (
          <div className="att-empty">Nobody left more than {criteria.minMinutes} minutes early {criteria.minTimes} or more times in {monthLabel(month)}.</div>
        ) : (
          <div className="att-early-list">
            <div className="att-early-row att-early-headrow"><span>Person</span><span>Times</span><span>Minutes early in all</span><span /></div>
            {people.map((p) => (
              <div key={p.employeeId} className={`att-early-person ${open === p.employeeId ? 'open' : ''}`}>
                <button type="button" className="att-early-row" onClick={() => setOpen(open === p.employeeId ? null : p.employeeId)} aria-expanded={open === p.employeeId}>
                  <span><b>{p.name}</b><small>{p.employeeCode}{p.department ? ` · ${p.department}` : ''}</small></span>
                  <span className="att-early-count">{p.count}</span>
                  <span>{Math.round(p.totalMinutes)} min <small>(about {Math.round(p.averageMinutes)} min a time)</small></span>
                  <Icon name={open === p.employeeId ? 'ChevronUp' : 'ChevronDown'} size={16} />
                </button>
                {open === p.employeeId && (
                  <table className="att-early-days">
                    <thead><tr><th>Date</th><th>Shift</th><th>Shift ends</th><th>Left at</th><th>Early by</th><th /></tr></thead>
                    <tbody>
                      {p.days.map((d) => (
                        <tr key={d.date}>
                          <td>{formatDayKey(d.date, { day: 'numeric', month: 'short' })} <small>{d.weekday}</small></td>
                          <td>{d.shiftName}</td>
                          <td>{formatTime(d.shiftEnd)}</td>
                          <td>{formatPunch(d.checkOut)}</td>
                          <td><b>{minutesText(d.minutesEarly)}</b></td>
                          <td>{d.permission ? <span className="att-early-permit">Permission approved</span> : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

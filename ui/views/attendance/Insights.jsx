import React, { useMemo } from 'react';
import { AiCard, BulletList } from '../../components/AiKit.jsx';
import { istMinutes, parseHHMM, clockLabel, durationLabel, monthLabel } from '../../utils/time.js';
import { statusMeta } from './meta.js';

function HoursChart({ days }) {
  const W = 720, H = 220, P = { l: 34, r: 10, t: 14, b: 26 };
  const shiftH = (days.find((d) => d.shiftMinutes)?.shiftMinutes || 480) / 60;
  const maxH = Math.max(10, Math.ceil(Math.max(shiftH, ...days.map((d) => (d.workedMinutes || 0) / 60)) + 1));
  const bw = (W - P.l - P.r) / Math.max(days.length, 1);
  const y = (h) => P.t + (H - P.t - P.b) * (1 - h / maxH);
  return (
    <svg className="att-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Hours worked per day">
      {Array.from({ length: Math.floor(maxH / 2) + 1 }).map((_, i) => (
        <g key={i}>
          <line x1={P.l} x2={W - P.r} y1={y(i * 2)} y2={y(i * 2)} stroke="#EFF3F6" />
          <text x={P.l - 6} y={y(i * 2) + 4} fontSize="10" textAnchor="end" fill="#807F84">{i * 2}h</text>
        </g>
      ))}
      <line x1={P.l} x2={W - P.r} y1={y(shiftH)} y2={y(shiftH)} stroke="#1F3445" strokeDasharray="5 4" />
      <text x={W - P.r} y={y(shiftH) - 4} fontSize="10" textAnchor="end" fill="#1F3445" fontWeight="700">shift {durationLabel(shiftH * 60, { short: true })}</text>
      {days.map((d, i) => {
        const h = (d.workedMinutes || 0) / 60;
        const x = P.l + i * bw + bw * 0.18;
        const w = bw * 0.64;
        const isOff = ['WEEK_OFF', 'HOLIDAY'].includes(d.status) && !d.workedOnHoliday;
        let fill = '#1F3445';
        if (Number(d.lateMinutes) > 0 || d.earlyLeaveMinutes > 0) fill = '#F38121';
        if (d.status === 'HALF_DAY') fill = '#F38121';
        if (d.status === 'IN_PROGRESS') fill = '#1F3445';
        return (
          <g key={d.date}>
            {isOff && <rect x={P.l + i * bw} y={P.t} width={bw} height={H - P.t - P.b} fill="#F7F7F8" />}
            {h > 0 ? <rect x={x} y={y(h)} width={w} height={Math.max(1, y(0) - y(h))} rx="3" fill={fill}><title>{`${d.date}: ${durationLabel(d.workedMinutes)}`}</title></rect>
              : d.status === 'ABSENT' ? <rect x={x} y={y(0) - 4} width={w} height="4" rx="2" fill="#F38121"><title>{`${d.date}: absent`}</title></rect> : null}
            {(i % 2 === 0 || days.length <= 16) && <text x={P.l + i * bw + bw / 2} y={H - 8} fontSize="9.5" textAnchor="middle" fill={d.isToday ? '#1F3445' : '#A2A1A6'} fontWeight={d.isToday ? 800 : 500}>{d.day}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function ArrivalChart({ days }) {
  const W = 1320, H = 210, P = { l: 70, r: 12, t: 12, b: 24 };
  const start = parseHHMM(days.find((d) => d.shiftStart)?.shiftStart) ?? 570;
  const grace = days.find((d) => d.shiftGraceMinutes)?.shiftGraceMinutes || 0;
  const points = days.filter((d) => d.checkIn).map((d) => ({ d, m: istMinutes(d.checkIn) }));
  const lo = Math.min(start - 45, ...points.map((p) => p.m)) - 10;
  const hi = Math.max(start + 75, ...points.map((p) => p.m)) + 10;
  const bw = (W - P.l - P.r) / Math.max(days.length, 1);
  const y = (m) => P.t + (H - P.t - P.b) * ((m - lo) / (hi - lo));
  const ticks = [];
  for (let t = Math.ceil(lo / 30) * 30; t <= hi; t += (hi - lo > 300 ? 60 : 30)) ticks.push(t);
  const label = (m) => clockLabel(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return (
    <svg className="att-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Check-in times">
      <rect x={P.l} y={y(start)} width={W - P.l - P.r} height={Math.max(1, y(start + grace) - y(start))} fill="rgba(243,129,33,0.14)" />
      {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#F2F2F3" /><text x={P.l - 6} y={y(t) + 3} fontSize="11" textAnchor="end" fill="#807F84">{label(t)}</text></g>)}
      <line x1={P.l} x2={W - P.r} y1={y(start)} y2={y(start)} stroke="#1F3445" strokeDasharray="5 4" />
      {points.map(({ d, m }) => {
        const i = days.indexOf(d);
        // The server's figure already allows for the grace (10:14:59 on time, 10:15:00 late).
        const late = d.status === 'IN_PROGRESS' ? m >= start + grace : Number(d.lateMinutes) > 0;
        return <circle key={d.date} cx={P.l + i * bw + bw / 2} cy={y(m)} r="6" fill={late ? '#F38121' : '#1F3445'} stroke="#FFFFFF" strokeWidth="2"><title>{`${d.date}: in at ${label(m)}`}</title></circle>;
      })}
      {days.map((d, i) => <text key={d.date} x={P.l + i * bw + bw / 2} y={H - 6} fontSize="11" textAnchor="middle" fill={d.isToday ? '#1F3445' : '#A2A1A6'}>{d.day}</text>)}
    </svg>
  );
}

function Donut({ summary }) {
  const parts = [
    // present includes WFH and the yellow "out time missing" days; show those apart.
    ['PRESENT', summary.present - (summary.wfh || 0) - (summary.needsReview || 0)],
    ['REVIEW', summary.needsReview || 0],
    ['WFH', summary.wfh || 0],
    ['HALF_DAY', summary.halfDays],
    ['LEAVE', summary.leaveDays],
    ['ABSENT', summary.absent]
  ].filter(([, v]) => v > 0);
  const total = parts.reduce((s, [, v]) => s + v, 0) || 1;
  const r = 52;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="att-donut-row">
      <svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="Day breakdown">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#F2F2F3" strokeWidth="18" />
        {parts.map(([k, v]) => {
          const len = (v / total) * c;
          const el = <circle key={k} cx="70" cy="70" r={r} fill="none" stroke={statusMeta(k).dot} strokeWidth="18" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />;
          acc += len;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" fontSize="22" fontWeight="800" fill="#142330">{summary.attendanceRate ?? '—'}{summary.attendanceRate != null ? '%' : ''}</text>
        <text x="70" y="84" textAnchor="middle" fontSize="10" fontWeight="700" fill="#807F84">attendance</text>
      </svg>
      <div className="att-donut-legend">
        {parts.length ? parts.map(([k, v]) => <div key={k}><span><i style={{ '--dot': statusMeta(k).dot }} />{statusMeta(k).label}</span><b>{v}</b></div>) : <div><span>No working days yet this month</span></div>}
        <div><span>Avg check-in</span><b>{summary.avgCheckIn ? clockLabel(summary.avgCheckIn) : '—'}</b></div>
        <div><span>Avg check-out</span><b>{summary.avgCheckOut ? clockLabel(summary.avgCheckOut) : '—'}</b></div>
        <div><span>Avg day</span><b>{summary.avgWorkedMinutes ? durationLabel(summary.avgWorkedMinutes) : '—'}</b></div>
      </div>
    </div>
  );
}

export default function Insights({ calendar, month, employeeId }) {
  const days = useMemo(() => (calendar?.days || []).filter((d) => !d.isFuture || d.isToday), [calendar]);
  const summary = calendar?.summary;
  if (!summary) return <div className="att-empty">Loading insights…</div>;
  const name = calendar?.employee ? `${calendar.employee.firstName}` : 'this person';
  return (
    <div className="att-insights">
      <div className="att-chart-card">
        <h4>Hours on duty</h4>
        <p>Each bar is one day in {monthLabel(month)}. Orange means a late arrival or early exit.</p>
        <HoursChart days={days} />
      </div>
      <div className="att-chart-card">
        <h4>Month at a glance</h4>
        <p>Working days so far: {summary.elapsedWorkingDays} of {summary.workingDays}</p>
        <Donut summary={summary} />
      </div>
      <div className="att-chart-card" style={{ gridColumn: '1 / -1' }}>
        <h4>Arrival pattern</h4>
        <p>Check-in time each day against the shift start (dashed line) and grace window (shaded).</p>
        <ArrivalChart days={days} />
      </div>
      <AiCard
        title={`Gemini attendance review · ${name}`}
        subtitle={`${monthLabel(month)} · patterns, risks and suggestions`}
        endpoint="/ai/attendance/insights"
        body={{ month, employeeId }}
        deps={[month, employeeId]}
        buttonLabel="Analyse this month"
        render={(res) => (
          <>
            <p className="ai-summary">{res.data?.summary}</p>
            <div className="ai-cols">
              <div><h5>Going well</h5><BulletList items={res.data?.highlights?.length ? res.data.highlights : ['No standout positives yet.']} tone="good" /></div>
              <div><h5>Watch out</h5><BulletList items={res.data?.risks?.length ? res.data.risks : ['Nothing worrying found.']} tone="bad" /></div>
              <div><h5>Suggested next steps</h5><BulletList items={res.data?.suggestions?.length ? res.data.suggestions : ['Keep it up.']} tone="idea" /></div>
            </div>
          </>
        )}
      />
    </div>
  );
}

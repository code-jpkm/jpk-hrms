// Replays the counting logic to show absent days no longer burn the quota.
const QUOTA = 3;

function runMonth(days, absentBurnsQuota) {
  let used = 0; const log = [];
  for (const d of days) {
    const isAbsent = d.status === 'ABSENT';
    const events = (d.late ? 1 : 0) + (d.early ? 1 : 0);
    if (!events) { log.push(`${d.day}: ${d.status} — no exception`); continue; }

    if (isAbsent && !absentBurnsQuota) {
      log.push(`${d.day}: ABSENT — 1.0 LOP, quota untouched (${used}/${QUOTA} used)`);
      continue;
    }
    let consumed = 0, lop = isAbsent ? 1 : 0;
    for (let i = 0; i < events; i++) {
      used += 1; consumed += 1;
      if (used > QUOTA) lop = Math.max(lop, 0.5);
    }
    const within = used <= QUOTA;
    log.push(`${d.day}: ${d.status} — ${consumed} event(s), ${used}/${QUOTA} used, LOP ${lop}${within ? ' (permitted)' : ' (QUOTA EXHAUSTED)'}`);
  }
  return { used, log };
}

const month = [
  { day: '01 Aug', status: 'ABSENT',  late: true,  early: false },
  { day: '04 Aug', status: 'ABSENT',  late: true,  early: false },
  { day: '07 Aug', status: 'PRESENT', late: true,  early: false },
  { day: '12 Aug', status: 'PRESENT', late: true,  early: false },
  { day: '18 Aug', status: 'PRESENT', late: false, early: true  },
  { day: '25 Aug', status: 'PRESENT', late: true,  early: false },
];

for (const [label, flag] of [['BEFORE (v25 as shipped)', true], ['AFTER (this fix)', false]]) {
  const r = runMonth(month, flag);
  console.log(`\n===== ${label} =====`);
  r.log.forEach(l => console.log('  ' + l));
  console.log(`  -> quota consumed by month end: ${r.used}`);
}

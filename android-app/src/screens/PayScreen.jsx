import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BadgeIndianRupee, Download } from '../components/icons';
import Screen from '../components/Screen';
import { TabTopBar } from '../components/TopBar';
import T from '../components/T';
import { Button, Card, Empty, Notice, SkeletonCard } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../state/AuthContext';
import { downloadAndOpen } from '../utils/files';
import { colors } from '../theme';
import { money, monthLabel } from '../utils/time';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
function sumExcept(obj, skip) {
  return Object.entries(obj || {}).reduce((t, [k, v]) => (skip.includes(k) ? t : t + (num(v) ?? num(v?.amount) ?? 0)), 0);
}
/** Earnings after unpaid-day cuts (the slip keeps full and prorated totals). */
function earningsTotal(e) {
  if (!e) return 0;
  return num(e.proratedGross) ?? num(e.gross) ?? sumExcept(e, ['gross', 'proratedGross']);
}
function deductionsTotal(d) {
  if (!d) return 0;
  return num(d.total) ?? sumExcept(d, ['total']);
}

function openPdf(slip) {
  return downloadAndOpen(`/payroll/slips/${slip._id}/pdf`, { fileName: `payslip-${slip.month}.pdf`, mimeType: 'application/pdf', title: `Payslip ${monthLabel(slip.month)}` });
}

export default function PayScreen() {
  const { employee } = useAuth();
  // Only your own, released payslips (admins also get drafts and everyone else's from this API).
  const slips = useApi(employee?._id ? `/payroll/slips?employeeId=${employee._id}` : null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const list = (slips.data?.slips || [])
    .filter((s) => String(s.employeeId?._id || s.employeeId) === String(employee?._id))
    .filter((s) => !s.payrollRunId || s.payrollRunId.status === 'FINALIZED')
    .sort((a, b) => String(b.month).localeCompare(String(a.month)));

  async function download(slip) {
    setBusy(slip._id);
    setError('');
    try { await openPdf(slip); } catch (err) { setError(err.message); } finally { setBusy(null); }
  }

  return (
    <Screen header={<TabTopBar title="Payslips" subtitle="Released by HR, newest first" />} onRefresh={slips.refresh} refreshing={slips.refreshing}>
      {!!error && <Notice style={{ marginBottom: 12 }}>{error}</Notice>}
      {!!slips.error && <Notice style={{ marginBottom: 12 }}>{slips.error.message}</Notice>}
      {!employee ? <Card><Empty icon={BadgeIndianRupee} title="No employee profile" text="Your sign-in is not linked to an employee record, so there are no payslips to show." /></Card>
        : !slips.data && !slips.error ? <SkeletonCard lines={3} /> : list.length ? list.map((slip) => {
        const gross = earningsTotal(slip.earnings);
        const ded = deductionsTotal(slip.deductions);
        const lopDays = Number(slip.lop?.days || 0);
        return (
          <Card key={slip._id} style={{ marginBottom: 12 }}>
            <View style={styles.head}>
              <View style={styles.icon}><BadgeIndianRupee size={20} color={colors.navy} /></View>
              <View style={{ flex: 1 }}>
                <T v="h3">{monthLabel(slip.month)}</T>
                <T v="small">{slip.attendanceStats?.payableDays != null ? `${slip.attendanceStats.payableDays} of ${slip.attendanceStats.workingDays ?? '–'} days paid` : 'Payslip'}</T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T v="eyebrow">Net pay</T>
                <T v="h2">{money(slip.netPay)}</T>
              </View>
            </View>
            {(gross > 0 || ded > 0) && (
              <View style={styles.split}>
                <View style={styles.box}><T v="eyebrow">Earnings</T><T v="strong">{money(gross)}</T></View>
                <View style={styles.box}><T v="eyebrow">Deductions</T><T v="strong">{money(ded)}</T></View>
              </View>
            )}
            {lopDays > 0 && <T v="small" style={{ marginTop: 8 }}>{lopDays} unpaid day{lopDays === 1 ? '' : 's'} ({money(slip.lop?.amount)}) already taken out of earnings.</T>}
            <Button title="Download PDF" variant="secondary" icon={Download} small loading={busy === slip._id} onPress={() => download(slip)} style={{ marginTop: 12 }} />
          </Card>
        );
      }) : <Card><Empty icon={BadgeIndianRupee} title="No payslips yet" text="Your payslip shows here as soon as HR releases the month’s payroll." /></Card>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center' },
  split: { flexDirection: 'row', gap: 10, marginTop: 12 },
  box: { flex: 1, backgroundColor: colors.gray50, borderRadius: 8, borderWidth: 1, borderColor: colors.line, padding: 10, gap: 2 }
});

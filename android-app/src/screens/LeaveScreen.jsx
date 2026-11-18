import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Plane, Plus, Undo2 } from '../components/icons';
import Screen from '../components/Screen';
import { TabTopBar } from '../components/TopBar';
import T from '../components/T';
import Sheet from '../components/Sheet';
import { DateField, Segmented, SelectField } from '../components/Pickers';
import { Button, Card, Empty, Field, Input, NoProfile, Notice, Pill, SectionTitle, SkeletonCard, statusTone } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { post } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { colors, radius, shadow } from '../theme';
import { daysBetween, formatDate, todayKey } from '../utils/time';
import { leaveName } from '../utils/attendance';
import { canSeeWfh } from '../utils/permissions';

const DAY_PARTS = [
  { value: 'FULL', label: 'Full day' },
  { value: 'FIRST_HALF', label: 'First half' },
  { value: 'SECOND_HALF', label: 'Second half' }
];

function ApplySheet({ visible, onClose, balances, onDone, allowWfh }) {
  const [form, setForm] = useState({ requestType: 'LEAVE', leaveType: '', fromDate: todayKey(), toDate: todayKey(), dayPart: 'FULL', reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Same rule as the website: leave types with a balance left, plus unpaid leave.
  const types = useMemo(() => {
    const list = (balances || [])
      .filter((b) => Number(b.available || 0) > 0)
      .sort((a, b) => String(a.leaveType).localeCompare(String(b.leaveType)))
      .map((b) => ({ value: String(b.leaveType).toUpperCase(), label: leaveName(b.leaveType), hint: `${Number(b.available || 0)} day(s) available` }));
    if (!list.some((t) => t.value === 'LOP')) list.push({ value: 'LOP', label: leaveName('LOP'), hint: 'Unpaid' });
    return list;
  }, [balances]);

  // Until the person picks a type, follow the first one that still has days
  // (balances may arrive after the sheet opens). Reset on every open.
  const [picked, setPicked] = useState(false);
  useEffect(() => { if (visible) { setError(''); setPicked(false); } }, [visible]);
  useEffect(() => {
    const next = types[0]?.value || 'LOP';
    if (!picked || !types.some((t) => t.value === form.leaveType)) setForm((f) => (f.leaveType === next ? f : { ...f, leaveType: next }));
  }, [types, picked, form.leaveType]);
  useEffect(() => { if (!allowWfh && form.requestType === 'WFH') setForm((f) => ({ ...f, requestType: 'LEAVE' })); }, [allowWfh, form.requestType]);

  const days = form.fromDate && form.toDate && form.toDate >= form.fromDate
    ? (form.dayPart === 'FULL' ? daysBetween(form.fromDate, form.toDate) : 0.5)
    : 0;
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v, ...(k === 'fromDate' && f.toDate < v ? { toDate: v } : {}), ...(k === 'dayPart' && v !== 'FULL' ? { toDate: f.fromDate } : {}) }));

  async function submit() {
    setError('');
    if (!form.reason.trim()) { setError('Write a short reason.'); return; }
    setBusy(true);
    try {
      const body = { ...form, leaveType: form.requestType === 'WFH' ? 'WFH' : form.leaveType, toDate: form.dayPart === 'FULL' ? form.toDate : form.fromDate, reason: form.reason.trim() };
      const res = await post('/leaves/apply', body);
      onDone(res?.message || 'Sent for approval.');
      setForm((f) => ({ ...f, reason: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Apply for leave" footer={<Button title={busy ? 'Sending…' : `Send for approval${days ? ` · ${days} day${days === 1 ? '' : 's'}` : ''}`} icon={Plane} loading={busy} onPress={submit} />}>
      {!!error && <Notice>{error}</Notice>}
      {allowWfh && <Segmented value={form.requestType} onChange={set('requestType')} options={[{ value: 'LEAVE', label: 'Leave' }, { value: 'WFH', label: 'Work from home' }]} />}
      {form.requestType === 'LEAVE' && (
        <Field label="Leave type"><SelectField value={form.leaveType} onChange={(v) => { setPicked(true); set('leaveType')(v); }} options={types} title="Leave type" /></Field>
      )}
      <Field label="Day"><Segmented value={form.dayPart} onChange={set('dayPart')} options={DAY_PARTS} /></Field>
      <Field label={form.dayPart === 'FULL' ? 'From' : 'Date'}><DateField value={form.fromDate} onChange={set('fromDate')} /></Field>
      {form.dayPart === 'FULL' && <Field label="To"><DateField value={form.toDate} onChange={set('toDate')} min={form.fromDate} /></Field>}
      <Field label="Reason"><Input value={form.reason} onChangeText={set('reason')} placeholder="For example: family function" multiline maxLength={300} /></Field>
    </Sheet>
  );
}

export default function LeaveScreen({ navigation, route }) {
  const { user, employee } = useAuth();
  const balances = useApi(employee ? '/leaves/balances' : null);
  const requests = useApi(employee ? '/leaves/requests' : null);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => { if (route.params?.apply) setApplying(true); }, [route.params?.apply]);

  const mine = (requests.data?.requests || []).filter((r) => String(r.employeeId?._id || r.employeeId) === String(employee?._id));
  const list = balances.data?.balances || [];

  async function withdraw(r) {
    setBusyId(r._id);
    try {
      const res = await post(`/leaves/${r._id}/cancel`, { reason: 'Withdrawn by employee' });
      setNotice({ ok: true, text: res?.message || 'Request withdrawn.' });
      requests.reload(); balances.reload();
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusyId(null);
    }
  }

  if (!employee) {
    return <Screen header={<TabTopBar title="Leave" subtitle="Balance, apply and your requests" />}><NoProfile what="leave" /></Screen>;
  }

  return (
    <Screen header={<TabTopBar title="Leave" subtitle="Balance, apply and your requests" />} onRefresh={() => { balances.refresh(); requests.refresh(); }} refreshing={balances.refreshing}>
      {notice && <Notice tone={notice.ok ? 'ok' : 'warn'} style={{ marginBottom: 12 }}>{notice.text}</Notice>}
      {!balances.data && !balances.error ? <SkeletonCard lines={2} /> : (
        <View style={styles.grid}>
          {list.length ? list.map((b) => (
            <View key={b._id || b.leaveType} style={styles.balance}>
              <T v="eyebrow" numberOfLines={1}>{leaveName(b.leaveType)}</T>
              <T v="big">{Number(b.available || 0)}</T>
              <T v="small">used {Number(b.used || 0)} of {Number(b.accrued || 0) + Number(b.carriedForward || 0) + Number(b.manualAdjusted || 0)}</T>
            </View>
          )) : <Card style={{ flex: 1 }}><T v="small">No leave balance yet. HR adds it from the leave policy.</T></Card>}
        </View>
      )}
      <Button title="Apply for leave" icon={Plus} style={{ marginTop: 14 }} onPress={() => setApplying(true)} />

      <SectionTitle title="My requests" />
      {!requests.data && !requests.error ? <SkeletonCard /> : mine.length ? (
        <Card padded={false}>
          {mine.map((r, i) => (
            <View key={r._id} style={[styles.req, i && styles.reqLine]}>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="strong">{r.requestType === 'WFH' ? 'Work from home' : leaveName(r.leaveType)} · {Number(r.days || 0)} day{Number(r.days) === 1 ? '' : 's'}</T>
                <T v="small">{formatDate(r.fromDate)}{String(r.toDate).slice(0, 10) !== String(r.fromDate).slice(0, 10) ? ` → ${formatDate(r.toDate)}` : ''}{r.dayPart && r.dayPart !== 'FULL' ? ` · ${r.dayPart === 'FIRST_HALF' ? 'first half' : 'second half'}` : ''}</T>
                {!!r.reason && <T v="small" numberOfLines={2}>“{r.reason}”</T>}
                {!!r.decisionRemarks && r.status !== 'PENDING' && <T v="small" color={colors.ink}>Note: {r.decisionRemarks}</T>}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Pill label={String(r.status || '').toLowerCase()} tone={statusTone(r.status)} />
                {r.status === 'PENDING' && <Button small variant="ghost" title="Withdraw" icon={Undo2} loading={busyId === r._id} onPress={() => withdraw(r)} />}
              </View>
            </View>
          ))}
        </Card>
      ) : <Card><Empty title="No leave requests" text="Requests you send appear here with their status." /></Card>}

      <ApplySheet
        visible={applying}
        onClose={() => setApplying(false)}
        balances={list}
        allowWfh={canSeeWfh(user, employee) && employee?.canApplyWfh === true}
        onDone={(text) => { setApplying(false); setNotice({ ok: true, text }); requests.reload(); balances.reload(); }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  balance: { flexGrow: 1, minWidth: '46%', backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 3, ...shadow(1) },
  req: { flexDirection: 'row', gap: 10, padding: 14 },
  reqLine: { borderTopWidth: 1, borderTopColor: colors.gray150 }
});

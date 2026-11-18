import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FilePenLine, Plus, Send } from '../components/icons';
import Screen from '../components/Screen';
import { PageTopBar } from '../components/TopBar';
import T from '../components/T';
import Sheet from '../components/Sheet';
import { DateField, SelectField, TimeField } from '../components/Pickers';
import { Button, Card, Empty, Field, Input, NoProfile, Notice, Pill, SkeletonCard, statusTone } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { post } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { colors } from '../theme';
import { formatDay, formatTime, todayKey } from '../utils/time';
import { CORRECTION_TYPES, correctionLabel } from '../utils/attendance';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function NewRequest({ visible, onClose, initialDate, onDone }) {
  const [form, setForm] = useState({ requestType: 'ATTENDANCE_CORRECTION', date: todayKey(), checkIn: '', checkOut: '', minutes: '', reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setError(''); setForm((f) => ({ ...f, date: initialDate || f.date || todayKey() })); } }, [visible, initialDate]);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const needsTimes = form.requestType === 'ATTENDANCE_CORRECTION';

  async function submit() {
    setError('');
    if (needsTimes && !form.checkIn && !form.checkOut) { setError('Enter the correct check-in and/or check-out time.'); return; }
    if ((form.checkIn && !TIME.test(form.checkIn)) || (form.checkOut && !TIME.test(form.checkOut))) { setError('Times look like 09:30 or 18:05 (24-hour).'); return; }
    if (!form.reason.trim()) { setError('Write a short reason.'); return; }
    setBusy(true);
    try {
      const body = {
        requestType: form.requestType,
        date: form.date,
        reason: form.reason.trim(),
        ...(form.checkIn ? { requestedCheckIn: `${form.date}T${form.checkIn}:00+05:30` } : {}),
        ...(form.checkOut ? { requestedCheckOut: `${form.date}T${form.checkOut}:00+05:30` } : {}),
        ...(!needsTimes && form.minutes ? { requestedMinutes: Number(form.minutes) || 0 } : {})
      };
      const res = await post('/regularizations/apply', body);
      onDone(res?.message || 'Sent for approval.');
      setForm((f) => ({ ...f, checkIn: '', checkOut: '', minutes: '', reason: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Request a correction" footer={<Button title={busy ? 'Sending…' : 'Send for approval'} icon={Send} loading={busy} onPress={submit} />}>
      {!!error && <Notice>{error}</Notice>}
      <Field label="What do you need?"><SelectField value={form.requestType} onChange={set('requestType')} options={CORRECTION_TYPES} title="Request type" /></Field>
      <Field label="Date"><DateField value={form.date} onChange={set('date')} max={todayKey()} /></Field>
      {needsTimes ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label="Check-in" style={{ flex: 1 }}><TimeField value={form.checkIn} onChange={set('checkIn')} placeholder="09:30" /></Field>
          <Field label="Check-out" style={{ flex: 1 }}><TimeField value={form.checkOut} onChange={set('checkOut')} placeholder="18:00" /></Field>
        </View>
      ) : (
        <Field label="Minutes (optional)"><Input value={form.minutes} onChangeText={(v) => set('minutes')(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" placeholder="e.g. 30" /></Field>
      )}
      <Field label="Reason"><Input value={form.reason} onChangeText={set('reason')} placeholder="For example: forgot to punch out" multiline maxLength={300} /></Field>
    </Sheet>
  );
}

export default function RequestsScreen({ route }) {
  const { employee } = useAuth();
  const list = useApi(employee ? '/regularizations' : null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  useEffect(() => { if (route.params?.create) setOpen(true); }, [route.params?.create]);
  const mine = (list.data?.requests || []).filter((r) => String(r.employeeId?._id || r.employeeId) === String(employee?._id));

  return (
    <Screen header={<PageTopBar title="Corrections & permissions" subtitle="Fix a missed punch, late coming, early leaving" />} onRefresh={list.refresh} refreshing={list.refreshing}>
      {!employee ? <NoProfile what="attendance" /> : <>
      {notice && <Notice tone={notice.ok ? 'ok' : 'warn'} style={{ marginBottom: 12 }}>{notice.text}</Notice>}
      <Button title="New request" icon={Plus} onPress={() => setOpen(true)} />
      <View style={{ height: 14 }} />
      {!list.data && !list.error ? <SkeletonCard /> : mine.length ? (
        <Card padded={false}>
          {mine.map((r, i) => (
            <View key={r._id} style={[styles.row, i && styles.line]}>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="strong">{correctionLabel(r.requestType)}</T>
                <T v="small">{formatDay(r.date)}{r.requestedCheckIn ? ` · in ${formatTime(r.requestedCheckIn)}` : ''}{r.requestedCheckOut ? ` · out ${formatTime(r.requestedCheckOut)}` : ''}{r.requestedMinutes ? ` · ${r.requestedMinutes} min` : ''}</T>
                {!!r.reason && <T v="small" numberOfLines={2}>“{r.reason}”</T>}
                {!!r.decisionRemarks && r.status !== 'PENDING' && <T v="small" color={colors.ink}>Note: {r.decisionRemarks}</T>}
              </View>
              <Pill label={String(r.status || '').toLowerCase()} tone={statusTone(r.status)} />
            </View>
          ))}
        </Card>
      ) : <Card><Empty icon={FilePenLine} title="No requests yet" text="Forgot to punch, came late or left early? Send a request and your approver decides." /></Card>}
      </>}
      <NewRequest visible={open} onClose={() => setOpen(false)} initialDate={route.params?.date} onDone={(text) => { setOpen(false); setNotice({ ok: true, text }); list.reload(); }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, padding: 14, alignItems: 'flex-start' },
  line: { borderTopWidth: 1, borderTopColor: colors.gray150 }
});

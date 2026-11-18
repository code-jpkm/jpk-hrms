import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, ClipboardCheck, X } from '../components/icons';
import Screen from '../components/Screen';
import { PageTopBar } from '../components/TopBar';
import T from '../components/T';
import Sheet from '../components/Sheet';
import { Avatar, Button, Card, Empty, Field, Input, Notice, SkeletonCard } from '../components/ui';
import { Segmented } from '../components/Pickers';
import { useApi } from '../hooks/useApi';
import { post } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { colors } from '../theme';
import { formatDate, formatDay, formatTime } from '../utils/time';
import { correctionLabel, leaveName } from '../utils/attendance';

const personName = (e) => `${e?.firstName || ''} ${e?.lastName || ''}`.trim() || 'Employee';
const isMine = (r, employee) => String(r.employeeId?._id || r.employeeId) === String(employee?._id);

function LeaveCard({ r, onDecide }) {
  const sameDay = String(r.toDate).slice(0, 10) === String(r.fromDate).slice(0, 10);
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={styles.head}>
        <Avatar name={personName(r.employeeId)} size={38} />
        <View style={{ flex: 1 }}>
          <T v="strong" numberOfLines={1}>{personName(r.employeeId)}</T>
          <T v="small" numberOfLines={1}>{[r.employeeId?.employeeCode, r.employeeId?.department].filter(Boolean).join(' · ')}</T>
        </View>
        <T v="small">{formatDate(r.createdAt, { year: false })}</T>
      </View>
      <View style={styles.box}>
        <T v="strong">{r.requestType === 'WFH' ? 'Work from home' : leaveName(r.leaveType)} · {Number(r.days || 0)} day{Number(r.days) === 1 ? '' : 's'}</T>
        <T v="small">{formatDate(r.fromDate)}{sameDay ? '' : ` → ${formatDate(r.toDate)}`}{r.dayPart && r.dayPart !== 'FULL' ? ` · ${r.dayPart === 'FIRST_HALF' ? 'first half' : 'second half'}` : ''}</T>
        {!!r.reason && <T v="small" color={colors.ink}>“{r.reason}”</T>}
      </View>
      <View style={styles.actions}>
        <Button title="Reject" variant="secondary" small icon={X} style={{ flex: 1 }} onPress={() => onDecide('leave', r, 'REJECTED')} />
        <Button title="Approve" small icon={Check} style={{ flex: 1 }} onPress={() => onDecide('leave', r, 'APPROVED')} />
      </View>
    </Card>
  );
}

function CorrectionCard({ r, onDecide }) {
  return (
    <Card style={{ marginBottom: 12 }}>
      <View style={styles.head}>
        <Avatar name={personName(r.employeeId)} size={38} />
        <View style={{ flex: 1 }}>
          <T v="strong" numberOfLines={1}>{personName(r.employeeId)}</T>
          <T v="small" numberOfLines={1}>{[r.employeeId?.employeeCode, r.employeeId?.department].filter(Boolean).join(' · ')}</T>
        </View>
        <T v="small">{formatDate(r.createdAt, { year: false })}</T>
      </View>
      <View style={styles.box}>
        <T v="strong">{correctionLabel(r.requestType)}</T>
        <T v="small">{formatDay(r.date)}{r.requestedCheckIn ? ` · in ${formatTime(r.requestedCheckIn)}` : ''}{r.requestedCheckOut ? ` · out ${formatTime(r.requestedCheckOut)}` : ''}{r.requestedMinutes ? ` · ${r.requestedMinutes} min` : ''}</T>
        {!!r.reason && <T v="small" color={colors.ink}>“{r.reason}”</T>}
      </View>
      <View style={styles.actions}>
        <Button title="Reject" variant="secondary" small icon={X} style={{ flex: 1 }} onPress={() => onDecide('correction', r, 'REJECTED')} />
        <Button title="Approve" small icon={Check} style={{ flex: 1 }} onPress={() => onDecide('correction', r, 'APPROVED')} />
      </View>
    </Card>
  );
}

export default function ApprovalsScreen() {
  const { employee } = useAuth();
  const leaves = useApi('/leaves/requests?status=PENDING');
  const corrections = useApi('/regularizations');
  const [tab, setTab] = useState('leave');
  const [deciding, setDeciding] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const leaveList = (leaves.data?.requests || []).filter((r) => r.status === 'PENDING' && !isMine(r, employee));
  const correctionList = (corrections.data?.requests || []).filter((r) => r.status === 'PENDING' && !isMine(r, employee));

  function onDecide(kind, request, status) {
    setRemarks('');
    setDeciding({ kind, request, status });
  }

  async function confirm() {
    const { kind, request, status } = deciding;
    setBusy(true);
    try {
      const path = kind === 'leave' ? `/leaves/${request._id}/decision` : `/regularizations/${request._id}/decision`;
      await post(path, { status, remarks: remarks.trim() || (status === 'APPROVED' ? 'Approved' : 'Rejected') });
      setNotice({ ok: true, text: `${personName(request.employeeId)}’s request ${status === 'APPROVED' ? 'approved' : 'rejected'}.` });
      setDeciding(null);
      (kind === 'leave' ? leaves : corrections).reload();
    } catch (err) {
      setNotice({ ok: false, text: err.message });
      setDeciding(null);
    } finally {
      setBusy(false);
    }
  }

  const loading = tab === 'leave' ? !leaves.data && !leaves.error : !corrections.data && !corrections.error;
  const list = tab === 'leave' ? leaveList : correctionList;

  return (
    <Screen header={<PageTopBar title="Approvals" subtitle="Requests from your team" />} onRefresh={() => { leaves.refresh(); corrections.refresh(); }} refreshing={leaves.refreshing || corrections.refreshing}>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'leave', label: `Leave · ${leaveList.length}` }, { value: 'correction', label: `Corrections · ${correctionList.length}` }]} />
      <View style={{ height: 12 }} />
      {notice && <Notice tone={notice.ok ? 'ok' : 'warn'} style={{ marginBottom: 12 }}>{notice.text}</Notice>}
      {(tab === 'leave' ? leaves.error : corrections.error) && <Notice style={{ marginBottom: 12 }}>{(tab === 'leave' ? leaves.error : corrections.error).message}</Notice>}
      {loading ? <SkeletonCard lines={3} /> : list.length ? list.map((r) => (
        tab === 'leave' ? <LeaveCard key={r._id} r={r} onDecide={onDecide} /> : <CorrectionCard key={r._id} r={r} onDecide={onDecide} />
      )) : <Card><Empty icon={ClipboardCheck} title="Nothing waiting" text={tab === 'leave' ? 'No leave requests need your decision.' : 'No corrections need your decision.'} /></Card>}

      <Sheet
        visible={!!deciding}
        onClose={() => !busy && setDeciding(null)}
        title={deciding ? `${deciding.status === 'APPROVED' ? 'Approve' : 'Reject'} ${personName(deciding.request.employeeId)}’s request?` : ''}
        footer={deciding ? <Button title={deciding.status === 'APPROVED' ? 'Approve' : 'Reject'} variant={deciding.status === 'APPROVED' ? 'primary' : 'danger'} icon={deciding.status === 'APPROVED' ? Check : X} loading={busy} onPress={confirm} /> : null}
      >
        <Field label="Note to the employee (optional)">
          <Input value={remarks} onChangeText={setRemarks} placeholder={deciding?.status === 'REJECTED' ? 'For example: team is short that week' : 'For example: enjoy your break'} multiline maxLength={200} />
        </Field>
        <T v="small">They get the decision in the app and by email or WhatsApp, if HR has turned those on.</T>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: { marginTop: 12, backgroundColor: colors.gray50, borderRadius: 8, borderWidth: 1, borderColor: colors.line, padding: 10, gap: 3 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 }
});

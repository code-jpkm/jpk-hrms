import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { ChevronRight, ExternalLink, FileText, KeyRound, LogOut, Server } from '../components/icons';
import Screen from '../components/Screen';
import { PageTopBar } from '../components/TopBar';
import T from '../components/T';
import { Avatar, Card, Notice, Pill, SectionTitle, SkeletonCard } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../state/AuthContext';
import { hostOf, serverUrl } from '../config';
import { colors, radius, shadow } from '../theme';
import { formatDate } from '../utils/time';
import { downloadAndOpen } from '../utils/files';

const ROLE_LABEL = { SUPER_ADMIN: 'Super Admin', HR_ADMIN: 'HR Admin', MANAGER: 'Manager', EMPLOYEE: 'Employee' };
const WORK_PLACE = { OFFICE: 'Office', FACTORY: 'Factory', BOTH: 'Office & factory' };

function Row({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <T v="small" style={{ width: 118 }}>{label}</T>
      <T v="strong" style={{ flex: 1 }} selectable>{value}</T>
    </View>
  );
}

function Action({ icon: Icon, label, hint, onPress, danger }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.navy25 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.actionIcon, danger && { backgroundColor: colors.orange50 }]}><Icon size={18} color={danger ? colors.orange : colors.navy} /></View>
      <View style={{ flex: 1 }}>
        <T v="strong" color={danger ? colors.orange : colors.ink}>{label}</T>
        {!!hint && <T v="small" numberOfLines={1}>{hint}</T>}
      </View>
      <ChevronRight size={18} color={colors.gray400} />
    </Pressable>
  );
}

export default function ProfileScreen({ navigation }) {
  const { user, employee, logout } = useAuth();
  const docs = useApi(employee?._id ? `/documents?ownerType=EMPLOYEE&ownerId=${employee._id}` : null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const name = employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() : user?.name;
  const documents = docs.data?.documents || [];

  async function openDoc(doc) {
    setBusy(doc._id); setError('');
    try { await downloadAndOpen(`/documents/${doc._id}/download`, { fileName: doc.fileName, mimeType: doc.mimeType, title: doc.label }); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  return (
    <Screen header={<PageTopBar title="My profile" />} onRefresh={docs.refresh} refreshing={docs.refreshing}>
      <View style={styles.hero}>
        <Avatar name={name} size={64} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h2" numberOfLines={1}>{name}</T>
          <T v="small" numberOfLines={1}>{[employee?.designation, employee?.department].filter(Boolean).join(' · ') || user?.email}</T>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
            <Pill label={ROLE_LABEL[user?.role] || user?.role || 'Employee'} tone="navy" />
            {!!employee?.employeeCode && <Pill label={employee.employeeCode} tone="muted" />}
          </View>
        </View>
      </View>

      {employee && (
        <>
          <SectionTitle title="Work details" />
          <Card>
            <Row label="Employee code" value={employee.employeeCode} />
            <Row label="Email" value={employee.email || user?.email} />
            <Row label="Phone" value={employee.phone} />
            <Row label="Works at" value={WORK_PLACE[employee.workLocation]} />
            <Row label="Joined on" value={employee.dateOfJoining ? formatDate(employee.dateOfJoining) : ''} />
            <Row label="Machine ID" value={employee.biometric?.code || employee.biometric?.deviceUserId} />
            <Row label="Emergency contact" value={employee.emergencyContact?.name ? `${employee.emergencyContact.name}${employee.emergencyContact.relation ? ` (${employee.emergencyContact.relation})` : ''}${employee.emergencyContact.phone ? ` · ${employee.emergencyContact.phone}` : ''}` : ''} />
          </Card>
          <T v="small" style={{ marginTop: 8 }}>Something wrong? Ask HR to correct it.</T>
        </>
      )}

      {employee && (
        <>
          <SectionTitle title="My documents" />
          {!!error && <Notice style={{ marginBottom: 10 }}>{error}</Notice>}
          {!docs.data && !docs.error ? <SkeletonCard lines={2} /> : documents.length ? (
            <Card padded={false}>
              {documents.map((d, i) => (
                <Pressable key={d._id} onPress={() => openDoc(d)} disabled={busy === d._id} style={({ pressed }) => [styles.doc, i && styles.line, pressed && { backgroundColor: colors.navy25 }]} accessibilityRole="button">
                  <FileText size={18} color={colors.navy} />
                  <View style={{ flex: 1 }}>
                    <T v="strong" numberOfLines={1}>{d.label || d.fileName}</T>
                    <T v="small" numberOfLines={1}>{busy === d._id ? 'Opening…' : `${d.fileName} · ${formatDate(d.createdAt)}`}</T>
                  </View>
                  {d.status === 'VERIFIED' && <Pill label="verified" tone="ok" />}
                </Pressable>
              ))}
            </Card>
          ) : <Card><T v="small">No documents yet. Letters and documents from HR appear here.</T></Card>}
        </>
      )}

      <SectionTitle title="Account" />
      <View style={styles.actions}>
        <Action icon={KeyRound} label="Change password" onPress={() => navigation.navigate('ChangePassword')} />
        <Action icon={ExternalLink} label="Open the website" hint={hostOf()} onPress={() => WebBrowser.openBrowserAsync(serverUrl())} />
        <Action icon={Server} label="Server address" hint={hostOf()} onPress={() => navigation.navigate('Server')} />
        <Action icon={LogOut} label="Sign out" danger onPress={logout} />
      </View>
      <T v="small" center style={{ marginTop: 16 }}>JPK HRMS app {Constants.expoConfig?.version || ''}</T>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, borderTopWidth: 3, borderTopColor: colors.orange, padding: 16, ...shadow(1) },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 7 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  line: { borderTopWidth: 1, borderTopColor: colors.gray150 },
  actions: { backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', ...shadow(1) },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  actionIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center' }
});

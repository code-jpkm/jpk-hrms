import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronRight, FileDown, ListTree, Network, Search, X } from '../components/icons';
import { PageTopBar } from '../components/TopBar';
import T from '../components/T';
import Sheet from '../components/Sheet';
import OrgTree from '../components/OrgTree';
import { SelectField } from '../components/Pickers';
import { Button, Empty, IconButton, Notice, SkeletonCard } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { downloadAndOpen } from '../utils/files';
import { colors, font, radius, shadow } from '../theme';
import { departmentPalette, departmentsOf, flattenOrgForest, indexOrgForest, personInitials, personName } from '../utils/orgChartLayout';

/**
 * Organisation chart, like the website: a List view (indented, open / close
 * teams) and a Tree view (cards joined by lines). Find a person, show one
 * team, and download either view as a PDF to share or print.
 */

const VIEW_KEY = 'jpk_org_view';

function ViewSwitch({ value, onChange }) {
  const items = [{ value: 'list', label: 'List', icon: ListTree }, { value: 'tree', label: 'Tree', icon: Network }];
  return (
    <View style={styles.seg} accessibilityRole="tablist">
      {items.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${o.label} view`}>
            <Icon size={15} color={on ? colors.navy : colors.gray600} />
            <T style={[styles.segText, on && { color: colors.navy, fontFamily: font.semibold }]}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

function ListRow({ row, open, onToggle, onPress, selected, match, colourOf }) {
  const p = row.node;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { paddingLeft: 10 + row.depth * 16 }, selected && styles.rowOn, match && styles.rowMatch, pressed && { backgroundColor: colors.navy25 }]}
      accessibilityRole="button"
      accessibilityLabel={`${personName(p)}, ${p.designation || 'Employee'}${row.reports ? `, ${row.reports} reports` : ''}`}
    >
      {row.reports ? (
        <Pressable onPress={onToggle} hitSlop={10} style={styles.rowToggle} accessibilityRole="button" accessibilityLabel={open ? `Hide ${personName(p)}'s team` : `Show ${personName(p)}'s team`}>
          {open ? <ChevronDown size={17} color={colors.navy} /> : <ChevronRight size={17} color={colors.navy} />}
        </Pressable>
      ) : <View style={styles.rowToggle}><View style={styles.dot} /></View>}
      <View style={[styles.rowAvatar, { borderColor: colourOf(p.department) }]}><T style={styles.rowInitials}>{personInitials(p)}</T></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T style={styles.rowName} numberOfLines={1}>{personName(p)}</T>
        <T style={styles.rowMeta} numberOfLines={1}>{[p.designation || 'Employee', p.department, p.employeeCode].filter(Boolean).join(' · ')}</T>
      </View>
      {row.reports > 0 && <View style={styles.count}><T style={styles.countText}>{row.collapsed ? `+${row.reports}` : row.reports}</T></View>}
    </Pressable>
  );
}

export default function OrgChartScreen() {
  const insets = useSafeAreaInsets();
  const chart = useApi('/hierarchy');
  const [view, setView] = useState('list');
  const [collapsed, setCollapsed] = useState({});
  const [focusId, setFocusId] = useState('');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [pdfError, setPdfError] = useState('');
  const listRef = useRef(null);

  useEffect(() => { AsyncStorage.getItem(VIEW_KEY).then((v) => { if (v === 'tree' || v === 'list') setView(v); }).catch(() => {}); }, []);
  const changeView = (v) => { setView(v); setSelectedId(''); AsyncStorage.setItem(VIEW_KEY, v).catch(() => {}); };

  const allRoots = chart.data?.tree || [];
  const index = useMemo(() => indexOrgForest(allRoots), [allRoots]);
  const everyone = useMemo(() => [...index.byId.values()], [index]);
  const colourOf = useMemo(() => departmentPalette(departmentsOf(allRoots)), [allRoots]);
  const focusNode = focusId ? index.byId.get(focusId) : null;
  const roots = useMemo(() => (focusNode ? [focusNode] : allRoots), [focusNode, allRoots]);
  const managers = useMemo(() => everyone.filter((p) => p.children?.length).sort((a, b) => personName(a).localeCompare(personName(b))), [everyone]);
  const unplaced = allRoots.filter((r) => !r.children?.length).length;
  const rows = useMemo(() => flattenOrgForest(roots, (id) => Boolean(collapsed[id])), [roots, collapsed]);
  const selected = selectedId ? index.byId.get(selectedId) : null;

  useEffect(() => { if (focusId && chart.data && !focusNode) setFocusId(''); }, [focusId, focusNode, chart.data]);

  const toggle = useCallback((id) => setCollapsed((c) => ({ ...c, [id]: !c[id] })), []);
  const expandAll = () => setCollapsed({});
  const collapseAll = () => { const next = {}; everyone.forEach((p) => { if (p.children?.length) next[String(p._id)] = true; }); setCollapsed(next); };

  const matches = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return everyone.filter((p) => {
      const hay = `${personName(p)} ${p.employeeCode || ''} ${p.designation || ''} ${p.department || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    }).slice(0, 6);
  }, [query, everyone]);

  function reveal(id) {
    // Open every team above the person; show the whole company if they are outside the team on screen.
    const above = [];
    for (let p = index.parentOf.get(id); p; p = index.parentOf.get(p)) above.push(p);
    if (focusId && id !== focusId && !above.includes(focusId)) setFocusId('');
    setCollapsed((c) => { const next = { ...c }; above.forEach((a) => { delete next[a]; }); return next; });
    setHighlight({ id, at: Date.now() });
    setSelectedId(id);
    setQuery('');
  }

  // List view: scroll to the person picked in the search.
  useEffect(() => {
    if (!highlight || view !== 'list') return undefined;
    const t = setTimeout(() => {
      const i = rows.findIndex((r) => r.id === highlight.id);
      if (i >= 0) listRef.current?.scrollToIndex({ index: i, viewPosition: 0.4, animated: true });
    }, 120);
    return () => clearTimeout(t);
  }, [highlight, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!highlight) return undefined;
    const t = setTimeout(() => setHighlight((h) => (h === highlight ? null : h)), 6000);
    return () => clearTimeout(t);
  }, [highlight]);

  async function downloadPdf(paper) {
    setBusy(paper); setPdfError('');
    try {
      const params = [`view=${view === 'tree' ? 'TREE' : 'LIST'}`, `paper=${paper}`];
      if (focusId) params.push(`rootId=${encodeURIComponent(focusId)}`);
      const closed = Object.keys(collapsed).filter((id) => collapsed[id]);
      if (closed.length) params.push(`collapsed=${closed.join(',')}`);
      const team = focusNode ? `-team-${personName(focusNode).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';
      const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
      await downloadAndOpen(`/hierarchy/chart.pdf?${params.join('&')}`, { fileName: `organisation-chart${team}${view === 'list' ? '-list' : ''}-${day}.pdf`, mimeType: 'application/pdf', title: 'Organisation chart' });
      setPdfOpen(false);
    } catch (err) {
      setPdfError(err.message || 'Could not make the PDF. Try again.');
    } finally {
      setBusy('');
    }
  }

  const focusSize = focusNode ? (index.teamSize.get(focusId) || 0) + 1 : 0;
  const header = <PageTopBar title="Organisation chart" subtitle="Who reports to whom" right={<IconButton icon={FileDown} label="Download PDF" onPress={() => { setPdfError(''); setPdfOpen(true); }} />} />;

  return (
    <View style={styles.root}>
      {header}
      <View style={styles.controls}>
        <View style={styles.line}>
          <ViewSwitch value={view} onChange={changeView} />
          <Pressable onPress={expandAll} style={styles.smallBtn} accessibilityRole="button" accessibilityLabel="Expand all"><T style={styles.smallBtnText}>Expand all</T></Pressable>
          <Pressable onPress={collapseAll} style={styles.smallBtn} accessibilityRole="button" accessibilityLabel="Collapse all"><T style={styles.smallBtnText}>Collapse all</T></Pressable>
        </View>
        <View style={styles.search}>
          <Search size={16} color={colors.faint} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Find a person" placeholderTextColor={colors.gray400} style={styles.searchInput} accessibilityLabel="Find a person on the chart" returnKeyType="search" onSubmitEditing={() => matches[0] && reveal(String(matches[0]._id))} />
          {!!query && <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search"><X size={16} color={colors.faint} /></Pressable>}
        </View>
        {!!query.trim() && (
          <View style={styles.results}>
            {matches.length ? matches.map((p) => (
              <Pressable key={p._id} onPress={() => reveal(String(p._id))} style={({ pressed }) => [styles.result, pressed && { backgroundColor: colors.navy25 }]} accessibilityRole="button" accessibilityLabel={`Show ${personName(p)}`}>
                <T style={styles.rowName} numberOfLines={1}>{personName(p)}</T>
                <T style={styles.rowMeta} numberOfLines={1}>{[p.employeeCode, p.designation, p.department].filter(Boolean).join(' · ')}</T>
              </Pressable>
            )) : <T v="small" style={{ padding: 12 }}>Nobody matches.</T>}
          </View>
        )}
        <SelectField
          value={focusId}
          onChange={(v) => { setFocusId(v); setSelectedId(''); }}
          title="Show"
          icon={Network}
          options={[{ value: '', label: 'Whole company', hint: `${everyone.length} people` }, ...managers.map((m) => ({ value: String(m._id), label: `Team of ${personName(m)}`, hint: `${(index.teamSize.get(String(m._id)) || 0) + 1} people` }))]}
        />
        <View style={styles.status}>
          {focusNode ? (
            <>
              <T style={styles.statusStrong}>Team of {personName(focusNode)}</T>
              <T style={styles.statusText}>{focusSize} {focusSize === 1 ? 'person' : 'people'}</T>
              <Pressable onPress={() => setFocusId('')} hitSlop={8} accessibilityRole="button"><T style={styles.link}>Whole company</T></Pressable>
            </>
          ) : (
            <T style={styles.statusText}><T style={styles.statusStrong}>{everyone.length}</T> people · <T style={styles.statusStrong}>{managers.length}</T> with a team{unplaced ? <> · <T style={styles.statusStrong}>{unplaced}</T> without a manager</> : null}</T>
          )}
        </View>
      </View>

      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {chart.error && !chart.data ? <Notice tone="warn">{chart.error.message}</Notice>
          : chart.loading && !chart.data ? <SkeletonCard lines={6} />
          : !allRoots.length ? <Empty title="Nobody on the chart yet" />
          : view === 'tree' ? (
            <OrgTree roots={roots} collapsed={collapsed} onToggle={toggle} colourOf={colourOf} highlight={highlight} focusKey={focusId || 'all'} separateUnplaced={!focusNode} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <FlatList
              ref={listRef}
              data={rows}
              keyExtractor={(r) => r.id}
              style={styles.list}
              contentContainerStyle={{ paddingVertical: 4 }}
              renderItem={({ item }) => (
                <ListRow row={item} open={!item.collapsed} onToggle={() => toggle(item.id)} onPress={() => setSelectedId((s) => (s === item.id ? '' : item.id))} selected={item.id === selectedId} match={highlight?.id === item.id} colourOf={colourOf} />
              )}
              onScrollToIndexFailed={({ index: i }) => setTimeout(() => listRef.current?.scrollToIndex({ index: i, viewPosition: 0.4 }), 250)}
              refreshControl={<RefreshControl refreshing={chart.refreshing} onRefresh={chart.refresh} tintColor={colors.navy} colors={[colors.navy]} />}
            />
          )}

        {selected && (
          <View style={styles.selbar} accessibilityLabel={`${personName(selected)} selected`}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T style={styles.rowName} numberOfLines={1}>{personName(selected)}</T>
              <T style={styles.rowMeta} numberOfLines={1}>{selected.designation || 'Employee'}{selected.children?.length ? ` · ${selected.children.length} direct report${selected.children.length === 1 ? '' : 's'}` : ''}</T>
            </View>
            {selected.children?.length > 0 && focusId !== String(selected._id) && (
              <Button small variant="secondary" icon={Network} title="Only this team" onPress={() => { setFocusId(String(selected._id)); setSelectedId(''); }} />
            )}
            <IconButton icon={X} label="Close" onPress={() => setSelectedId('')} />
          </View>
        )}
      </View>

      <Sheet visible={pdfOpen} onClose={() => setPdfOpen(false)} title="Download PDF">
        <T v="small">{view === 'tree' ? 'The tree as you see it' : 'The list as you see it'}{focusNode ? `, team of ${personName(focusNode)}` : ', whole company'}. Closed teams stay closed. Share it, save it or print it.</T>
        {view === 'tree' ? (
          <>
            <PdfChoice title="Full size" text="One page with the whole chart. Zoom in to read." busy={busy === 'FULL'} disabled={!!busy} onPress={() => downloadPdf('FULL')} />
            <PdfChoice title="A4, ready to print" text="Big charts are split into teams, readable on paper." busy={busy === 'A4'} disabled={!!busy} onPress={() => downloadPdf('A4')} />
            <PdfChoice title="A3, ready to print" text="Bigger sheets, fewer pages." busy={busy === 'A3'} disabled={!!busy} onPress={() => downloadPdf('A3')} />
          </>
        ) : (
          <PdfChoice title="A4 list" text="Everyone in order, with their manager's team lines." busy={busy === 'A4'} disabled={!!busy} onPress={() => downloadPdf('A4')} />
        )}
        {!!pdfError && <Notice tone="warn">{pdfError}</Notice>}
      </Sheet>
    </View>
  );
}

function PdfChoice({ title, text, onPress, busy, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.choice, pressed && { backgroundColor: colors.navy25 }, disabled && !busy && { opacity: 0.55 }]} accessibilityRole="button" accessibilityLabel={`Download ${title}`} accessibilityState={{ busy, disabled }}>
      <View style={styles.choiceIcon}><FileDown size={18} color={colors.navy} /></View>
      <View style={{ flex: 1 }}>
        <T v="strong">{busy ? 'Making the PDF…' : title}</T>
        <T v="small">{text}</T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  controls: { paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  seg: { flexDirection: 'row', backgroundColor: colors.gray100, borderRadius: 9, padding: 3, marginRight: 'auto' },
  segBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 7 },
  segOn: { backgroundColor: '#FFFFFF', ...shadow(1) },
  segText: { fontFamily: font.medium, fontSize: 13, color: colors.gray600 },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFFFF' },
  smallBtnText: { fontFamily: font.semibold, fontSize: 12, color: colors.navy900 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFFFF' },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 14, color: colors.ink, paddingVertical: 8 },
  results: { backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', ...shadow(2) },
  result: { paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.gray150 },
  status: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingBottom: 2 },
  statusText: { fontFamily: font.regular, fontSize: 12.5, color: colors.gray700 },
  statusStrong: { fontFamily: font.semibold, fontSize: 12.5, color: colors.ink },
  link: { fontFamily: font.semibold, fontSize: 12.5, color: colors.orange, textDecorationLine: 'underline' },
  body: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  list: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingRight: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.gray150 },
  rowOn: { backgroundColor: colors.navy50 },
  rowMatch: { backgroundColor: colors.orange50 },
  rowToggle: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.gray300 },
  rowAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  rowInitials: { fontFamily: font.bold, fontSize: 11, color: '#FFFFFF' },
  rowName: { fontFamily: font.semibold, fontSize: 13.5, color: colors.ink },
  rowMeta: { fontFamily: font.regular, fontSize: 11.5, color: colors.muted },
  count: { minWidth: 30, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.navy50, alignItems: 'center' },
  countText: { fontFamily: font.bold, fontSize: 11.5, color: colors.navy },
  selbar: { position: 'absolute', left: 20, right: 20, bottom: 18, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 6, paddingVertical: 8, backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, ...shadow(3) },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  choiceIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center' }
});

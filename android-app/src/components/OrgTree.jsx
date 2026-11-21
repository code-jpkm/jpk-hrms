import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ChevronUp, Maximize2, Minus, Plus } from './icons';
import T from './T';
import { colors, font, radius, shadow } from '../theme';
import { layoutOrgChart, ORG_CHART_SIZES, personInitials, personName } from '../utils/orgChartLayout';

/**
 * The organisation chart as a tree, like the website: cards joined by lines,
 * top down. One finger moves it, two fingers pinch to zoom, the buttons zoom
 * and fit. The small button under a card opens or closes that person's team
 * (the card stays where it is). Tapping a card selects it.
 */

const MIN_ZOOM = 0.06;
const MAX_ZOOM = 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default function OrgTree({ roots, collapsed, onToggle, colourOf, highlight, focusKey, separateUnplaced, selectedId, onSelect }) {
  const layout = useMemo(
    () => layoutOrgChart(roots, { ...ORG_CHART_SIZES.screen, separateUnplaced, isCollapsed: (id) => Boolean(collapsed[id]) }),
    [roots, collapsed, separateUnplaced]
  );
  const boxById = useMemo(() => new Map(layout.boxes.map((b) => [b.id, b])), [layout]);

  const box = useRef(null);
  const size = useRef({ w: 0, h: 0 });
  const origin = useRef({ x: 0, y: 0 });
  const view = useRef({ x: 0, y: 0, k: 1 });
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const sc = useRef(new Animated.Value(1)).current;
  const [zoom, setZoom] = useState(100);
  const [ready, setReady] = useState(false);
  const anchor = useRef(null);
  const centred = useRef(0);
  const fittedFor = useRef(null);

  const apply = useCallback((v, showZoom = true) => {
    view.current = v;
    tx.setValue(v.x);
    ty.setValue(v.y);
    sc.setValue(v.k);
    if (showZoom) setZoom(Math.round(v.k * 100));
  }, [tx, ty, sc]);

  const fit = useCallback((mode = 'fit') => {
    const { w, h } = size.current;
    if (!w || !h || !layout.boxes.length) return;
    const pad = 20;
    const padTop = 62; // below the zoom buttons
    const fitK = clamp(Math.min((w - 2 * pad) / layout.width, (h - padTop - pad) / layout.height), MIN_ZOOM, 1);
    if (mode === 'fit' || fitK >= 0.5) {
      apply({ k: fitK, x: (w - layout.width * fitK) / 2, y: Math.max(padTop, padTop + (h - padTop - pad - layout.height * fitK) / 2) });
      return;
    }
    // Too big to read when it all fits: start readable, on the top of the chart.
    const k = 0.62;
    const top = layout.boxes.reduce((best, b) => (b.depth === 0 && (!best || b.y < best.y) ? b : best), null) || layout.boxes[0];
    apply({ k, x: w / 2 - (top.x + top.w / 2) * k, y: padTop });
  }, [layout, apply]);

  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    size.current = { w: width, h: height };
    box.current?.measureInWindow?.((x, y) => { origin.current = { x: x || 0, y: y || 0 }; });
    if (!ready) {
      fittedFor.current = focusKey;
      fit('start');
      setReady(true);
    }
  };

  // A different team shown: start again from its top.
  useEffect(() => {
    if (!ready || fittedFor.current === focusKey) return;
    fittedFor.current = focusKey;
    fit('start');
  }, [focusKey, ready, fit]);

  // Opening or closing a team keeps that card where it was on the screen.
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const b = boxById.get(a.id);
    const v = view.current;
    if (!b) return;
    apply({ ...v, x: v.x + (a.sx - (b.x * v.k + v.x)), y: v.y + (a.sy - (b.y * v.k + v.y)) }, false);
  }, [boxById, apply]);

  // A person picked in the search: bring their card to the middle.
  useEffect(() => {
    if (!ready || !highlight?.id || centred.current === highlight.at) return;
    const b = boxById.get(highlight.id);
    if (!b) return;
    centred.current = highlight.at;
    const k = Math.max(view.current.k, 0.85);
    const { w, h } = size.current;
    apply({ k, x: w / 2 - (b.x + b.w / 2) * k, y: h / 2 - (b.y + b.h / 2) * k });
  }, [highlight, boxById, ready, apply]);

  const toggle = useCallback((id) => {
    const b = boxById.get(id);
    const v = view.current;
    if (b) anchor.current = { id, sx: b.x * v.k + v.x, sy: b.y * v.k + v.y };
    onToggle(id);
  }, [boxById, onToggle]);

  function zoomBy(factor) {
    const v = view.current;
    const { w, h } = size.current;
    const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
    apply({ k, x: w / 2 - (w / 2 - v.x) * (k / v.k), y: h / 2 - (h / 2 - v.y) * (k / v.k) });
  }

  // One finger moves, two fingers zoom around the middle of the pinch. Taps go to the cards.
  const gesture = useRef({ last: null, pinch: null, down: null });
  const responder = useMemo(() => PanResponder.create({
    // Note where the finger first landed (without taking the touch from the cards),
    // so a drag moves the chart by the whole distance, the first few pixels included.
    onStartShouldSetPanResponderCapture: (e) => {
      const t = e.nativeEvent.touches[0] || e.nativeEvent;
      gesture.current.down = { x: t.pageX, y: t.pageY };
      return false;
    },
    onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponder: (e, g) => e.nativeEvent.touches.length >= 2 || Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
    onMoveShouldSetPanResponderCapture: (e, g) => e.nativeEvent.touches.length >= 2 || Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      box.current?.measureInWindow?.((x, y) => { origin.current = { x: x || 0, y: y || 0 }; });
      const t = e.nativeEvent.touches[0] || e.nativeEvent;
      const down = gesture.current.down;
      gesture.current = { last: down || { x: t.pageX, y: t.pageY }, pinch: null, down: null };
    },
    onPanResponderMove: (e) => {
      const ts = e.nativeEvent.touches;
      const gs = gesture.current;
      if (ts.length >= 2) {
        const [a, b] = ts;
        const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) || 1;
        const mx = (a.pageX + b.pageX) / 2 - origin.current.x;
        const my = (a.pageY + b.pageY) / 2 - origin.current.y;
        if (!gs.pinch) { gs.pinch = { dist, mx, my, v: { ...view.current } }; gs.last = null; return; }
        const v0 = gs.pinch.v;
        const k = clamp(v0.k * (dist / gs.pinch.dist), MIN_ZOOM, MAX_ZOOM);
        apply({ k, x: mx - (gs.pinch.mx - v0.x) * (k / v0.k), y: my - (gs.pinch.my - v0.y) * (k / v0.k) }, false);
        return;
      }
      const t = ts[0] || e.nativeEvent;
      gs.pinch = null;
      if (gs.last) {
        const v = view.current;
        apply({ ...v, x: v.x + t.pageX - gs.last.x, y: v.y + t.pageY - gs.last.y }, false);
      }
      gs.last = { x: t.pageX, y: t.pageY };
    },
    onPanResponderRelease: () => { gesture.current = { last: null, pinch: null, down: null }; setZoom(Math.round(view.current.k * 100)); },
    onPanResponderTerminate: () => { gesture.current = { last: null, pinch: null, down: null }; setZoom(Math.round(view.current.k * 100)); }
  }), [apply]);

  const highlightId = highlight?.id || '';
  const stage = useMemo(() => {
    const d = layout.lines.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('');
    return (
      <>
        <Svg width={layout.width} height={layout.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={d} stroke="#A8B3BE" strokeWidth={1.5} fill="none" />
        </Svg>
        {layout.section && (
          <View style={[styles.section, { left: layout.section.x, top: layout.section.y, width: layout.section.w }]} pointerEvents="none">
            <T style={styles.sectionText}>{layout.section.label}</T>
          </View>
        )}
        {layout.boxes.map((b) => {
          const p = b.node;
          const name = personName(p);
          const on = b.id === selectedId;
          const match = b.id === highlightId;
          return (
            <Pressable
              key={b.id}
              onPress={() => onSelect(on ? '' : b.id)}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${p.designation || 'Employee'}${b.reports ? `, ${b.reports} direct reports` : ''}`}
              style={[styles.card, { left: b.x, top: b.y, width: b.w, height: b.h }, on && styles.cardOn, match && styles.cardMatch]}
            >
              <View style={[styles.cardBar, { backgroundColor: colourOf(p.department) }]} />
              <View style={styles.avatar}>
                {p.profilePhotoUrl
                  ? <Image source={{ uri: p.profilePhotoUrl }} style={styles.avatarImg} />
                  : <T style={styles.initials}>{personInitials(p)}</T>}
              </View>
              <View style={styles.cardText}>
                <T style={styles.name} numberOfLines={1}>{name}</T>
                <T style={styles.job} numberOfLines={1}>{p.designation || 'Employee'}</T>
                <T style={styles.meta} numberOfLines={1}>{[p.department, p.employeeCode].filter(Boolean).join(' · ')}</T>
              </View>
            </Pressable>
          );
        })}
        {layout.boxes.filter((b) => b.reports > 0).map((b) => (
          <Pressable
            key={`t-${b.id}`}
            onPress={() => toggle(b.id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={b.collapsed ? `Show ${personName(b.node)}'s ${b.reports} direct reports` : `Hide ${personName(b.node)}'s team`}
            style={({ pressed }) => [styles.toggle, b.collapsed && styles.toggleClosed, { left: b.x + b.w / 2 - 17, top: b.y + b.h - 12 }, pressed && { backgroundColor: colors.navy100 }]}
          >
            {b.collapsed ? <T style={styles.toggleText}>+{b.reports}</T> : <ChevronUp size={14} color={colors.navy} strokeWidth={2.4} />}
          </Pressable>
        ))}
      </>
    );
  }, [layout, selectedId, highlightId, colourOf, toggle, onSelect]);

  return (
    <View style={styles.wrap}>
      <View ref={box} style={styles.canvas} onLayout={onLayout} {...responder.panHandlers}>
        {!layout.boxes.length ? <T v="small" style={styles.empty}>Nobody to show.</T> : (
          <Animated.View
            style={[styles.stage, { width: layout.width, height: layout.height, opacity: ready ? 1 : 0, transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }] }]}
          >
            {stage}
          </Animated.View>
        )}
      </View>
      <View style={styles.zoom}>
        <Pressable onPress={() => zoomBy(1 / 1.25)} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom out" hitSlop={4}><Minus size={16} color={colors.navy} /></Pressable>
        <T style={styles.zoomText}>{zoom}%</T>
        <Pressable onPress={() => zoomBy(1.25)} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Zoom in" hitSlop={4}><Plus size={16} color={colors.navy} /></Pressable>
        <Pressable onPress={() => fit('fit')} style={styles.zoomBtn} accessibilityRole="button" accessibilityLabel="Fit the whole chart" hitSlop={4}><Maximize2 size={15} color={colors.navy} /></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.gray50, overflow: 'hidden' },
  // On the web build the browser must not scroll or zoom the page under the fingers.
  canvas: { flex: 1, overflow: 'hidden', ...(Platform.OS === 'web' ? { touchAction: 'none', userSelect: 'none' } : null) },
  stage: { position: 'absolute', left: 0, top: 0, transformOrigin: 'left top' },
  empty: { textAlign: 'center', marginTop: 40 },
  section: { position: 'absolute', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.gray300 },
  sectionText: { fontFamily: font.bold, fontSize: 13, color: colors.gray700 },
  card: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 11, paddingLeft: 13, paddingRight: 12, paddingTop: 9, paddingBottom: 15, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DCDCE0', borderRadius: 10 },
  cardOn: { borderColor: colors.navy, borderWidth: 2 },
  cardMatch: { borderColor: colors.orange, borderWidth: 3 },
  cardBar: { position: 'absolute', left: 10, right: 10, top: -1, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: 40, height: 40 },
  initials: { fontFamily: font.bold, fontSize: 13, color: '#FFFFFF' },
  cardText: { flex: 1, minWidth: 0 },
  name: { fontFamily: font.bold, fontSize: 13.5, lineHeight: 17, color: colors.navy900 },
  job: { fontFamily: font.regular, fontSize: 12, lineHeight: 16, color: colors.gray800 },
  meta: { fontFamily: font.regular, fontSize: 11, lineHeight: 15, color: colors.faint },
  toggle: { position: 'absolute', width: 34, height: 24, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.navy200, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  toggleClosed: { backgroundColor: colors.navy50 },
  toggleText: { fontFamily: font.bold, fontSize: 11.5, color: colors.navy },
  zoom: { position: 'absolute', right: 10, top: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 3, paddingVertical: 3, ...shadow(2) },
  zoomBtn: { width: 34, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  zoomText: { minWidth: 44, textAlign: 'center', fontFamily: font.bold, fontSize: 12, color: colors.gray700 }
});

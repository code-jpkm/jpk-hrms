import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3 } from './icons';
import T from './T';
import { IconButton } from './ui';
import { colors, font, radius, shadow } from '../theme';
import { formatDay, monthLabel, shiftMonth, todayKey, WEEKDAYS } from '../utils/time';

function Trigger({ icon: Icon, text, placeholder, onPress, disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => [styles.trigger, pressed && { borderColor: colors.navy }, disabled && { opacity: 0.6 }]}>
      {Icon ? <Icon size={17} color={colors.gray600} /> : null}
      <T style={{ flex: 1, color: text ? colors.navy900 : colors.gray400, fontSize: 15 }} numberOfLines={1}>{text || placeholder}</T>
      <ChevronDown size={16} color={colors.gray400} />
    </Pressable>
  );
}

/** Date field with a month calendar (no native date picker needed). value = 'YYYY-MM-DD'. */
export function DateField({ value, onChange, min, max, placeholder = 'Choose a date', disabled }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState((value || todayKey()).slice(0, 7));
  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = Array.from({ length: first }, () => null);
    for (let d = 1; d <= count; d += 1) cells.push(`${month}-${String(d).padStart(2, '0')}`);
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [month]);
  const today = todayKey();
  return (
    <>
      <Trigger icon={CalendarDays} text={value ? formatDay(value) : ''} placeholder={placeholder} onPress={() => { setMonth((value || today).slice(0, 7)); setOpen(true); }} disabled={disabled} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.calendar} onPress={() => {}}>
            <View style={styles.calHead}>
              <IconButton icon={ChevronLeft} label="Previous month" onPress={() => setMonth(shiftMonth(month, -1))} />
              <T v="h3" center style={{ flex: 1 }}>{monthLabel(month)}</T>
              <IconButton icon={ChevronRight} label="Next month" onPress={() => setMonth(shiftMonth(month, 1))} />
            </View>
            <View style={styles.week}>{WEEKDAYS.map((w) => <T key={w} v="small" center style={styles.cell}>{w.slice(0, 2)}</T>)}</View>
            <View style={styles.grid}>
              {days.map((key, i) => {
                if (!key) return <View key={`e${i}`} style={styles.cell} />;
                const off = (min && key < min) || (max && key > max);
                const selected = key === value;
                return (
                  <Pressable key={key} disabled={off} onPress={() => { onChange(key); setOpen(false); }} style={styles.cell} accessibilityRole="button" accessibilityLabel={formatDay(key)}>
                    <View style={[styles.day, key === today && styles.today, selected && styles.selected]}>
                      <T style={{ fontFamily: selected ? font.bold : font.medium, color: selected ? '#FFFFFF' : off ? colors.gray300 : colors.navy900, fontSize: 14 }}>{Number(key.slice(8))}</T>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => { if (!(min && today < min) && !(max && today > max)) { onChange(today); setOpen(false); } }} style={styles.todayBtn}>
              <T v="small" weight="semibold" color={colors.navy}>Today</T>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** "HH:MM" (24 h) typed with a number pad; shows 12 h hint. */
export function TimeField({ value, onChange, placeholder = 'HH:MM' }) {
  const [focused, setFocused] = useState(false);
  function update(text) {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    onChange(digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits);
  }
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
  const hint = valid ? (() => { const [h, m] = value.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; })() : '';
  return (
    <View style={[styles.trigger, focused && { borderColor: colors.navy }]}>
      <Clock3 size={17} color={colors.gray600} />
      <TextInput
        value={value}
        onChangeText={update}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        placeholder={placeholder}
        placeholderTextColor={colors.gray400}
        maxLength={5}
        style={{ flex: 1, fontFamily: font.regular, fontSize: 15, color: colors.navy900, paddingVertical: 0 }}
      />
      {!!hint && <T v="small">{hint}</T>}
    </View>
  );
}

/** Pick one option from a list (opens a panel). options = [{ value, label, hint }] */
export function SelectField({ value, onChange, options, placeholder = 'Choose', title = 'Choose one', icon }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <>
      <Trigger icon={icon} text={selected?.label} placeholder={placeholder} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.list} onPress={() => {}}>
            <T v="h3" style={{ padding: 16, paddingBottom: 8 }}>{title}</T>
            <ScrollView style={{ maxHeight: 420 }}>
              {options.map((o) => (
                <Pressable key={o.value} onPress={() => { onChange(o.value); setOpen(false); }} style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.navy25 }]} accessibilityRole="button">
                  <View style={{ flex: 1 }}>
                    <T v="strong">{o.label}</T>
                    {!!o.hint && <T v="small">{o.hint}</T>}
                  </View>
                  {o.value === value && <Check size={18} color={colors.navy} />}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** Two to four choices in a row (like the website's tab buttons). */
export function Segmented({ value, onChange, options }) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segBtn, on && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <T style={{ fontFamily: on ? font.semibold : font.medium, fontSize: 13, color: on ? colors.navy : colors.gray600 }} numberOfLines={1}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF' },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,35,48,0.45)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  calendar: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: radius.lg, padding: 10, borderTopWidth: 4, borderTopColor: colors.orange, ...shadow(3) },
  calHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  week: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1, borderColor: colors.orange },
  selected: { backgroundColor: colors.navy },
  todayBtn: { alignSelf: 'center', padding: 10 },
  list: { width: '100%', maxWidth: 380, backgroundColor: '#FFFFFF', borderRadius: radius.lg, paddingBottom: 8, borderTopWidth: 4, borderTopColor: colors.orange, ...shadow(3) },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.gray150, gap: 10 },
  segment: { flexDirection: 'row', backgroundColor: colors.gray100, borderRadius: 9, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: 'center' },
  segOn: { backgroundColor: '#FFFFFF', ...shadow(1) }
});

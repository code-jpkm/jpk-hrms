import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { RefreshCw } from './icons';
import T from './T';
import { Field, Input } from './ui';
import { get } from '../api/client';
import { colors } from '../theme';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeBase64(input) {
  if (typeof globalThis.atob === 'function') {
    try { return decodeURIComponent(escape(globalThis.atob(input))); } catch { /* fall through */ }
  }
  let out = '';
  const str = String(input).replace(/[^A-Za-z0-9+/]/g, '');
  for (let i = 0; i < str.length; i += 4) {
    const n = (B64.indexOf(str[i]) << 18) | (B64.indexOf(str[i + 1]) << 12) | ((B64.indexOf(str[i + 2]) & 63) << 6) | (B64.indexOf(str[i + 3]) & 63);
    out += String.fromCharCode((n >> 16) & 255);
    if (str[i + 2] !== undefined) out += String.fromCharCode((n >> 8) & 255);
    if (str[i + 3] !== undefined) out += String.fromCharCode(n & 255);
  }
  return out;
}

function svgFromDataUrl(url) {
  const comma = String(url || '').indexOf(',');
  return comma < 0 ? '' : decodeBase64(String(url).slice(comma + 1));
}

/**
 * The server's picture captcha: 5 letters to type. Each picture works once;
 * call ref.current.refresh() after every attempt. onChange gets
 * { token, answer, required }.
 */
const Captcha = forwardRef(function Captcha({ onChange, disabled }, ref) {
  const [picture, setPicture] = useState(null);
  const [answer, setAnswer] = useState('');
  const [state, setState] = useState('loading');
  const inputRef = useRef(null);
  const timer = useRef(null);

  const refresh = useCallback(async ({ focus = false } = {}) => {
    setState('loading');
    setAnswer('');
    try {
      const data = await get('/auth/captcha', { timeout: 45000 });
      const svg = svgFromDataUrl(data.image);
      setPicture({ ...data, svg });
      setState('ready');
      onChange?.({ token: data.token, answer: '', required: data.required !== false });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => refresh(), Math.max(30, (data.expiresInSeconds || 300) - 20) * 1000);
      if (focus) setTimeout(() => inputRef.current?.focus(), 50);
    } catch (error) {
      setState(error.code === 'NO_SERVER' ? 'noserver' : 'failed');
      onChange?.({ token: '', answer: '', required: true });
    }
  }, [onChange]);

  useImperativeHandle(ref, () => ({ refresh, focus: () => inputRef.current?.focus() }), [refresh]);
  useEffect(() => {
    refresh();
    return () => clearTimeout(timer.current);
  }, []); // first picture once

  if (picture && picture.required === false) return null;

  function update(value) {
    const clean = value.replace(/\s+/g, '').slice(0, 8);
    setAnswer(clean);
    onChange?.({ token: picture?.token || '', answer: clean, required: true });
  }

  return (
    <Field label="Type the letters you see" hint="Not case-sensitive. Can’t read it? Tap ↻ for a new picture.">
      <View style={styles.row}>
        <View style={styles.pic} accessibilityLabel="Security picture with 5 letters" accessible>
          {state === 'ready' && picture?.svg
            ? <SvgXml xml={picture.svg} width="100%" height="100%" />
            : state === 'loading'
              ? <ActivityIndicator color={colors.navy} />
              : <T v="small" center>{state === 'noserver' ? 'Set the server first' : 'Picture not loaded'}</T>}
        </View>
        <Pressable onPress={() => refresh({ focus: true })} disabled={state === 'loading' || disabled} accessibilityRole="button" accessibilityLabel="Show a new picture" hitSlop={6} style={({ pressed }) => [styles.refresh, pressed && { backgroundColor: colors.navy50 }]}>
          <RefreshCw size={18} color={colors.gray600} />
        </Pressable>
        <Input
          inputRef={inputRef}
          value={answer}
          onChangeText={update}
          placeholder="5 letters"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          maxLength={8}
          editable={!disabled}
          style={styles.answer}
          accessibilityLabel="Letters from the picture"
        />
      </View>
    </Field>
  );
});

export default Captcha;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pic: { width: 132, height: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: '#F4F6FA', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  refresh: { width: 36, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  answer: { flex: 1, minWidth: 0, letterSpacing: 2, fontWeight: '600' }
});

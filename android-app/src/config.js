import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Where the HRMS lives. Comes from EXPO_PUBLIC_SERVER_URL when the APK is
 * built (eas.json), and can be changed on the sign-in screen ("Server").
 * It is the same address you open in the browser; the app adds /api itself.
 */
const KEY = 'jpk_hrms_server';
const BUILT_IN = String(process.env.EXPO_PUBLIC_SERVER_URL || '').trim();

let current = normalise(BUILT_IN);

export function normalise(value) {
  let v = String(value || '').trim();
  if (!v || /YOUR-HRMS-ADDRESS/i.test(v)) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  return v.replace(/\/+$/, '').replace(/\/api$/i, '');
}

export function serverUrl() {
  return current;
}

export function apiBase() {
  return current ? `${current}/api` : '';
}

export function builtInServer() {
  return normalise(BUILT_IN);
}

export async function loadServer() {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved) current = normalise(saved);
  } catch {
    // keep the built-in address
  }
  return current;
}

export async function saveServer(value) {
  current = normalise(value);
  if (current && current !== builtInServer()) await AsyncStorage.setItem(KEY, current);
  else await AsyncStorage.removeItem(KEY);
  return current;
}

export function hostOf(url = current) {
  return String(url || '').replace(/^https?:\/\//i, '');
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiBase } from '../config';

const TOKEN_KEY = 'jpk_hrms_token';
let token = null;
const listeners = new Set();

export async function loadToken() {
  token = await AsyncStorage.getItem(TOKEN_KEY);
  return token;
}

export async function setToken(value) {
  token = value || null;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export function getToken() {
  return token;
}

/** 'unauthorized' (signed out elsewhere) and 'password-change-required'. */
export function onAuthEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(type) {
  listeners.forEach((fn) => fn(type));
}

export class ApiError extends Error {
  constructor(message, { status = 0, code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** JSON request to the HRMS API. Throws ApiError with the server's own message. */
export async function api(path, { method = 'GET', body, timeout = 25000, headers = {} } = {}) {
  const base = apiBase();
  if (!base) throw new ApiError('Set the HRMS server address first.', { code: 'NO_SERVER' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    const slow = error?.name === 'AbortError';
    throw new ApiError(
      slow
        ? 'The HRMS server is taking too long. If it was asleep it may need a minute: try again.'
        : 'Cannot reach the HRMS server. Check your internet connection.',
      { code: slow ? 'TIMEOUT' : 'OFFLINE' }
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!res.ok) {
    const details = data?.details;
    const code = details && typeof details === 'object' && !Array.isArray(details) ? details.code : undefined;
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/change-password')) emit('unauthorized');
    if (res.status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') emit('password-change-required');
    const message = data?.message
      || (res.status === 503 || res.status === 502 ? 'The HRMS server is starting up. Try again in a minute.' : `Request failed (${res.status})`);
    throw new ApiError(message, { status: res.status, code, details });
  }
  return data;
}

export const get = (path, opts) => api(path, { ...opts, method: 'GET' });
export const post = (path, body = {}, opts) => api(path, { ...opts, method: 'POST', body });

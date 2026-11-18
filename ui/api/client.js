import toast from 'react-hot-toast';

// v27: the API is part of this app, so it lives at /api on the same address.
// NEXT_PUBLIC_API_BASE_URL is only needed to point the pages at another server.
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || '/api').replace(/\/$/, '');

export function getToken() {
  return localStorage.getItem('hrms_token');
}

export function setToken(token) {
  if (token) localStorage.setItem('hrms_token', token);
  else localStorage.removeItem('hrms_token');
}

function loadingMessageFor(method, path) {
  if (path.includes('/shifts/assign')) return 'Assigning shift and recalculating attendance…';
  if (/\/shifts$/.test(path) && method === 'POST') return 'Creating shift…';
  if (path.includes('/leaves/') && path.includes('/decision')) return 'Saving leave decision…';
  if (path.includes('/leaves/apply')) return 'Submitting leave request…';
  if (path.includes('/payroll/') && path.includes('/release')) return 'Releasing payroll…';
  if (path.includes('/payroll/run')) return 'Generating payroll…';
  if (path.includes('/import-excel')) return 'Importing Excel file…';
  if (method === 'DELETE') return 'Deleting…';
  if (method === 'PATCH' || method === 'PUT') return 'Saving changes…';
  return 'Processing…';
}

function successMessageFor(method, path, data = {}) {
  if (data?.message) return data.message;
  if (data?.created) return 'Created successfully';
  if (data?.updated) return 'Updated successfully';
  if (data?.deleted) return 'Deleted successfully';
  if (path.includes('/shifts/assign')) return 'Shift assigned and attendance recalculated';
  if (/\/shifts$/.test(path) && method === 'POST') return 'Shift created successfully';
  if (path.includes('/decision')) return 'Decision saved successfully';
  if (path.includes('/apply')) return 'Request submitted successfully';
  if (path.includes('/payroll/') && path.includes('/release')) return 'Payroll released successfully';
  if (path.includes('/payroll/run')) return 'Payroll generated successfully';
  if (path.includes('/import-excel')) return 'Excel import completed';
  if (method === 'DELETE') return 'Deleted successfully';
  if (method === 'PATCH' || method === 'PUT') return 'Changes saved successfully';
  return 'Operation completed successfully';
}

export async function api(path, options = {}) {
  const {
    toast: toastEnabled = true,
    successMessage,
    loadingMessage,
    errorMessage,
    ...fetchOptions
  } = options;

  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const mutating = !['GET', 'HEAD'].includes(method);
  const showToast = mutating && toastEnabled !== false;
  const headers = { ...(fetchOptions.headers || {}) };
  if (fetchOptions.body && !(fetchOptions.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const toastId = showToast ? toast.loading(loadingMessage || loadingMessageFor(method, path), { duration: Infinity }) : null;
  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...fetchOptions, headers });
  } catch (error) {
    if (showToast) toast.error(errorMessage || 'Could not reach the HRMS server. Check your connection and try again.', { id: toastId, duration: 5200 });
    throw error;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = errorMessage || `Request failed: ${res.status}`;
    let details;
    if (contentType.includes('application/json')) {
      try {
        const data = await res.json();
        message = data.message || message;
        details = data.details;
      } catch (_) { /* keep the generic message */ }
    }
    if (res.status === 429) message = 'Too many requests. Wait a few seconds and try again.';
    // An expired or revoked session: let AuthContext sign the person out once,
    // instead of every button failing until they reload the page.
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/change-password')) {
      window.dispatchEvent(new CustomEvent('hrms:unauthorized'));
    }
    // Signed in with a temporary password: the app asks for a new one first.
    if (res.status === 403 && details && details.code === 'PASSWORD_CHANGE_REQUIRED') {
      window.dispatchEvent(new CustomEvent('hrms:password-change-required'));
    }
    if (showToast) toast.error(message, { id: toastId, duration: 5600 });
    const error = new Error(message);
    error.status = res.status;
    error.details = details;
    error.code = details && typeof details === 'object' && !Array.isArray(details) ? details.code : undefined;
    throw error;
  }

  if (contentType.includes('application/json')) {
    let data;
    try {
      data = await res.json();
    } catch (error) {
      if (showToast) toast.error('The server sent an unreadable response.', { id: toastId });
      throw error;
    }
    if (showToast) {
      const warnings = Array.isArray(data?.errors) ? data.errors.length : Number(data?.failed || 0);
      if (warnings > 0) toast(`${successMessage || successMessageFor(method, path, data)} ${warnings} row(s) need attention.`, { id: toastId, icon: '⚠️', duration: 6000 });
      else toast.success(successMessage || successMessageFor(method, path, data), { id: toastId, duration: 3600 });
    }
    return data;
  }

  if (showToast) toast.success(successMessage || successMessageFor(method, path), { id: toastId, duration: 3600 });
  return res.blob();
}

export function post(path, body, options = {}) {
  return api(path, { ...options, method: 'POST', body: JSON.stringify(body || {}) });
}

export function patch(path, body, options = {}) {
  return api(path, { ...options, method: 'PATCH', body: JSON.stringify(body || {}) });
}

export function put(path, body, options = {}) {
  return api(path, { ...options, method: 'PUT', body: JSON.stringify(body || {}) });
}

export function remove(path, options = {}) {
  return api(path, { ...options, method: 'DELETE' });
}

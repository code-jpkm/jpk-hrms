import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getToken } from '../api/client';
import { apiBase } from '../config';

function safeName(name) {
  return String(name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'file';
}

/**
 * Downloads a signed-in file (payslip PDF, HR document) and opens the phone's
 * share / open-with sheet. On the web build it opens the file in a new tab.
 */
export async function downloadAndOpen(path, { fileName = 'file', mimeType = 'application/octet-stream', title } = {}) {
  const url = `${apiBase()}${path}`;
  const headers = { Authorization: `Bearer ${getToken()}` };
  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Could not download the file. Try again.');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
    return;
  }
  const target = `${FileSystem.cacheDirectory}${Date.now()}-${safeName(fileName)}`;
  let res;
  try {
    res = await FileSystem.downloadAsync(url, target, { headers });
  } catch {
    throw new Error('No internet connection. Check your network and try again.');
  }
  if (res.status !== 200) {
    FileSystem.deleteAsync(res.uri, { idempotent: true }).catch(() => {});
    throw new Error(res.status === 401 ? 'Your session ended. Sign in again.' : 'Could not download the file. Try again.');
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone cannot open the file.');
  await Sharing.shareAsync(res.uri, { mimeType, dialogTitle: title || fileName, UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined });
}

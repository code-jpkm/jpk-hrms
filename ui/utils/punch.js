import { post } from '../api/client.js';

/**
 * Mobile check-in / check-out: asks the browser for the location (the server
 * decides whether it is inside an approved site) and records the punch.
 */
export async function punchNow(mode) {
  if (!navigator.geolocation) throw new Error('This browser cannot share your location, which is needed for mobile attendance.');
  const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    resolve,
    (err) => reject(new Error(err.code === 1 ? 'Location permission was denied. Allow location for this site and try again.' : 'Could not get your location. Move to an open area and try again.')),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  ));
  return post(`/attendance/mobile-check-${mode}`, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }, { loadingMessage: mode === 'in' ? 'Checking you in…' : 'Checking you out…' });
}

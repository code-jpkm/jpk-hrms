/**
 * Where a phone check-in / check-out was made: the exact GPS point the phone
 * sent (latitude, longitude, how accurate the phone said it was) and a link that
 * opens that point in Google Maps. Machine punches have no location.
 */

function round(value, places) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Google Maps link for a point (opens the Maps app on a phone). */
function mapUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** A location as stored on a punch, made safe to show; null when it has no point. */
function cleanLocation(location, at) {
  if (!location) return null;
  const lat = round(location.lat, 7);
  const lng = round(location.lng, 7);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const accuracy = round(location.accuracy, 0);
  return {
    lat,
    lng,
    accuracy: accuracy !== null && accuracy >= 0 ? accuracy : null,
    address: location.address ? String(location.address).slice(0, 300) : '',
    siteName: location.siteName || '',
    distanceMeters: location.distanceMeters !== null && location.distanceMeters !== undefined && Number.isFinite(Number(location.distanceMeters)) ? Math.round(Number(location.distanceMeters)) : null,
    at: at || null,
    mapUrl: mapUrl(lat, lng)
  };
}

/**
 * The check-in and check-out locations of an attendance record. Each phone punch
 * keeps its own point in meta.mobile; older records only kept the last one in
 * `location`, which is then the check-out (or the check-in when there is no out).
 */
function punchLocations(record) {
  if (!record) return { in: null, out: null };
  const mobile = record.meta?.mobile || {};
  let checkIn = cleanLocation(mobile.checkInLocation, mobile.checkInCapturedAt || record.checkIn);
  let checkOut = cleanLocation(mobile.checkOutLocation, mobile.checkOutCapturedAt || record.checkOut);
  if (!checkIn && !checkOut) {
    const last = cleanLocation(record.location, null);
    if (last) {
      if (record.checkOut) checkOut = { ...last, at: record.checkOut };
      else checkIn = { ...last, at: record.checkIn || null };
    }
  }
  return { in: checkIn, out: checkOut };
}

/** "22.5726420, 88.3638920 · ±8 m · Bentinck Street" — one line for a report cell. */
function locationLabel(location) {
  if (!location) return '';
  const parts = [`${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`];
  if (location.accuracy !== null && location.accuracy !== undefined) parts.push(`±${location.accuracy} m`);
  if (location.siteName) parts.push(location.siteName);
  else if (location.address) parts.push(location.address);
  return parts.join(' · ');
}

module.exports = { mapUrl, cleanLocation, punchLocations, locationLabel };

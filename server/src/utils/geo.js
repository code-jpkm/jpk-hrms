function toRad(value) {
  return (value * Math.PI) / 180;
}

function distanceMeters(a, b) {
  const earthRadius = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function findAllowedSite(point, sites = []) {
  if (!point || typeof point.lat !== 'number' || typeof point.lng !== 'number') return null;
  for (const site of sites) {
    if (site.active === false) continue;
    if (typeof site.lat !== 'number' || typeof site.lng !== 'number') continue;
    const dist = distanceMeters(point, { lat: site.lat, lng: site.lng });
    if (dist <= site.radiusMeters) return { ...(site.toObject?.() || site), distanceMeters: Math.round(dist) };
  }
  return null;
}

module.exports = { distanceMeters, findAllowedSite };

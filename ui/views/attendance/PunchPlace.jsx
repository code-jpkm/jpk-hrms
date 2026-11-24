import React from 'react';
import Icon from '../../components/Icon.jsx';
import { formatPunch } from '../../utils/time.js';

/** "22.572642, 88.363892" */
export function pointLabel(place) {
  return `${Number(place.lat).toFixed(6)}, ${Number(place.lng).toFixed(6)}`;
}

/**
 * Where a phone punch was made: the exact point the phone sent, how accurate the
 * phone said it was, and a link that opens it in Google Maps.
 */
export function PunchPlace({ label, place, compact = false }) {
  if (!place) return null;
  const extra = [
    place.accuracy !== null && place.accuracy !== undefined ? `±${place.accuracy} m` : '',
    place.siteName || place.address || ''
  ].filter(Boolean).join(' · ');
  if (compact) {
    return (
      <a className="att-place-chip" href={place.mapUrl} target="_blank" rel="noopener noreferrer" title={`${label}: ${pointLabel(place)}${extra ? ` (${extra})` : ''} — open in Google Maps`}>
        <Icon name="MapPin" size={12} /> {label}
      </a>
    );
  }
  return (
    <a className="att-place" href={place.mapUrl} target="_blank" rel="noopener noreferrer">
      <Icon name="MapPin" size={16} />
      <span>
        <b>{label}{place.at ? ` · ${formatPunch(place.at)}` : ''}</b>
        <small>{pointLabel(place)}{extra ? ` · ${extra}` : ''}</small>
      </span>
      <em>Google Maps <Icon name="ExternalLink" size={12} /></em>
    </a>
  );
}

/** Both punches of a day, or nothing when neither was made on a phone. */
export default function PunchPlaces({ places }) {
  if (!places?.in && !places?.out) return null;
  return (
    <div className="att-box">
      <h4>Where the punch was made</h4>
      <div className="att-places">
        <PunchPlace label="Check-in" place={places.in} />
        <PunchPlace label="Check-out" place={places.out} />
      </div>
      <p className="att-place-note">The exact point the phone sent. ± is how accurate the phone said it was.</p>
    </div>
  );
}

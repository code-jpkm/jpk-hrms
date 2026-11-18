import React from 'react';

/** First paint while the app starts in the browser. Safe to render on the server. */
export default function BootScreen() {
  return (
    <div className="jpk-boot" role="status" aria-live="polite" aria-label="Opening JPK HRMS">
      <img src="/brand/jpk-logo.png" alt="JPK Metallics" width="132" height="40" />
      <span className="jpk-boot-bar"><span /></span>
    </div>
  );
}

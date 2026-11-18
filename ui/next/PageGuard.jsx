'use client';

import React from 'react';
import { useAuth } from '../state/AuthContext.jsx';
import { canAccessPath } from '../utils/permissions.js';

export default function PageGuard({ path, children }) {
  const { user } = useAuth();
  if (!canAccessPath(user, path)) {
    return (
      <div className="page">
        <section className="page-hero compact premium-hero">
          <div>
            <small>RESTRICTED MODULE</small>
            <h1>Access denied</h1>
            <p>You do not have permission to open this module.</p>
          </div>
        </section>
      </div>
    );
  }
  return children;
}

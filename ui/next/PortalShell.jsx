'use client';

import React from 'react';
import { Navigate, useLocation } from '../lib/router.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import Layout from '../components/Layout.jsx';
import { RouteSkeleton } from '../components/Loading.jsx';
import SetPassword from '../views/SetPassword.jsx';

/** Everything behind sign-in: the session check, then the app frame (top bar, menus). */
export default function PortalShell({ children }) {
  const { user, loading, unreachable, retry, logout } = useAuth();
  const location = useLocation();

  if (loading) return <RouteSkeleton />;
  if (!user && unreachable) {
    return (
      <div className="jpk-login">
        <div className="jpk-login-card">
          <img className="jpk-login-logo" src="/brand/jpk-logo.png" alt="JPK Metallics" />
          <h1>Can't reach the HRMS server</h1>
          <p>Your session is safe. Check your internet connection, then try again. If it keeps happening, tell HR.</p>
          <button type="button" className="primary" onClick={retry}>Try again</button>
          <button type="button" className="secondary" onClick={logout}>Sign in with another account</button>
        </div>
      </div>
    );
  }
  if (!user) {
    const back = `${location.pathname}${location.search}`;
    return <Navigate to={back && back !== '/' ? `/login?next=${encodeURIComponent(back)}` : '/login'} replace />;
  }
  if (user.forcePasswordChange) return <SetPassword />;
  return <Layout>{children}</Layout>;
}

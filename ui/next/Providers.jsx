'use client';

import React from 'react';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '../state/AuthContext.jsx';

/** Session + toasts for every page. Loaded in the browser only (see app/client-root.jsx). */
export default function Providers({ children }) {
  return (
    <AuthProvider>
      {children}
      <Toaster
        position="top-right"
        gutter={10}
        containerStyle={{ top: 70, right: 18, zIndex: 99999 }}
        toastOptions={{
          duration: 3600,
          className: 'jpk-toast',
          style: {
            minWidth: '280px',
            maxWidth: '420px',
            borderRadius: '8px',
            padding: '12px 14px',
            fontWeight: 500,
            fontSize: '13.5px',
            color: '#1F3445',
            background: '#FFFFFF',
            border: '1px solid #E1E1E4',
            boxShadow: '0 12px 32px rgba(31,52,69,.16)'
          },
          success: { iconTheme: { primary: '#1F3445', secondary: '#fff' } },
          error: { iconTheme: { primary: '#F38121', secondary: '#fff' } },
          loading: { duration: Infinity }
        }}
      />
    </AuthProvider>
  );
}

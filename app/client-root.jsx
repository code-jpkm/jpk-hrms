'use client';

import dynamic from 'next/dynamic';
import BootScreen from '@/ui/next/BootScreen.jsx';

// The app keeps the session in the browser (localStorage), so it starts there:
// the server sends a light boot screen and the browser takes over.
const Providers = dynamic(() => import('@/ui/next/Providers.jsx'), { ssr: false, loading: () => <BootScreen /> });

export default function ClientRoot({ children }) {
  return <Providers>{children}</Providers>;
}

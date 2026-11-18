'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BootScreen from '@/ui/next/BootScreen.jsx';

// Unknown address: go to the home page (as before).
export default function NotFound() {
  const router = useRouter();
  useEffect(() => { router.replace('/'); }, [router]);
  return <BootScreen />;
}

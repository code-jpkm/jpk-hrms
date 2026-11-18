'use client';

import PortalShell from '@/ui/next/PortalShell.jsx';

/** Every page behind sign-in shares the top bar, menus and session check. */
export default function PortalLayout({ children }) {
  return <PortalShell>{children}</PortalShell>;
}

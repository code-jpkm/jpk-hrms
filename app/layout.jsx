import '@/ui/styles.css';
import '@/ui/styles/theme.css';
import ClientRoot from './client-root.jsx';

export const metadata = {
  title: { default: 'JPK HRMS', template: '%s · JPK HRMS' },
  description: 'JPK Metallics HRMS: attendance, leave, payroll and people.',
  icons: { icon: '/favicon.png' },
  robots: { index: false, follow: false }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1F3445'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  );
}

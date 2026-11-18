import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Email, WhatsApp & AI' };

export default function Page() {
  return <RouteView view="integrations" guard="/integrations" />;
}

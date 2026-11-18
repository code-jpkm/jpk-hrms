import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Company settings' };

export default function Page() {
  return <RouteView view="settings" guard="/settings" />;
}

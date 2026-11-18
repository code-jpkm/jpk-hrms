import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Holidays' };

export default function Page() {
  return <RouteView view="holidays" guard="/holidays" />;
}

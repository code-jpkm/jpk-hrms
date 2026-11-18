import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Shifts' };

export default function Page() {
  return <RouteView view="shifts" guard="/shifts" />;
}

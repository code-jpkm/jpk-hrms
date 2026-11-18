import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Probation' };

export default function Page() {
  return <RouteView view="probation" guard="/probation" />;
}

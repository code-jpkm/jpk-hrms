import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Organisation chart' };

export default function Page() {
  return <RouteView view="hierarchy" guard="/hierarchy" />;
}

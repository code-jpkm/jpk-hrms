import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Leave' };

export default function Page() {
  return <RouteView view="leave" guard="/leave" />;
}

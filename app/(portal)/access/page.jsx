import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'User access' };

export default function Page() {
  return <RouteView view="access" guard="/access" />;
}

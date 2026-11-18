import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Employees' };

export default function Page() {
  return <RouteView view="employees" guard="/employees" />;
}

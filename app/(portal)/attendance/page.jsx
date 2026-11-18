import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Attendance' };

export default function Page() {
  return <RouteView view="attendance" guard="/attendance" />;
}

import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Attendance correction' };

export default function Page() {
  return <RouteView view="regularization" guard="/regularization" />;
}

import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Attendance machines' };

export default function Page() {
  return <RouteView view="biometric" guard="/biometric" />;
}

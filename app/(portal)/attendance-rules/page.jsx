import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Attendance rules' };

export default function Page() {
  return <RouteView view="attendanceRules" guard="/attendance-rules" />;
}

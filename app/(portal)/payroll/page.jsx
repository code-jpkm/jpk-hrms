import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Payroll' };

export default function Page() {
  return <RouteView view="payroll" guard="/payroll" />;
}

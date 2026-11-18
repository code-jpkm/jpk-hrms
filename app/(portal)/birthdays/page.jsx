import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Celebrations' };

export default function Page() {
  return <RouteView view="birthdays" guard="/birthdays" />;
}

import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Recruitment' };

export default function Page() {
  return <RouteView view="recruitment" guard="/recruitment" />;
}

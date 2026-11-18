import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'AI assistant' };

export default function Page() {
  return <RouteView view="ai" guard="/ai" />;
}

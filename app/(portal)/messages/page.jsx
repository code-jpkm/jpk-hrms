import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Send a message' };

export default function Page() {
  return <RouteView view="messages" guard="/messages" />;
}

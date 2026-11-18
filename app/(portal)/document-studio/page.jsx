import RouteView from '@/ui/next/RouteView.jsx';

export const metadata = { title: 'Letters & documents' };

export default function Page() {
  return <RouteView view="documentStudio" guard="/document-studio" />;
}

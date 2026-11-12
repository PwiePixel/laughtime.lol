import OfflinePage from '@/components/pwa/OfflinePage';

export const metadata = { title: 'Offline', robots: { index: false } };

// Shown by the service worker (public/sw.js) when a page cannot be loaded.
export default function Offline() {
  return <OfflinePage />;
}

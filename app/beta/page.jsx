import BetaPage from '@/components/beta/BetaPage';

// the canonical address is always the one on the main host – whatever host or
// channel the visitor is on (metadataBase is PUBLIC_URL, see app/layout.jsx)
export const metadata = { title: 'Beta', alternates: { canonical: '/beta' } };

export default function Page() {
  return <BetaPage />;
}

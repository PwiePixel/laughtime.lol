import { Suspense } from 'react';
import AccountPage from '@/components/AccountPage';

export const metadata = { title: 'Account', robots: { index: false } };

export default function Account() {
  return (
    <Suspense fallback={null}>
      <AccountPage />
    </Suspense>
  );
}

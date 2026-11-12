import { Suspense } from 'react';
import AdminPage from '@/components/AdminPage';

export const metadata = { title: 'Admin', robots: { index: false } };

export default function Admin() {
  return (
    <Suspense fallback={null}>
      <AdminPage />
    </Suspense>
  );
}

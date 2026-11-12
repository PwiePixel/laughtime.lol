import { Suspense } from 'react';
import AuthPage from '@/components/AuthPage';

export const metadata = { title: 'Login', robots: { index: false } };

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthPage />
    </Suspense>
  );
}

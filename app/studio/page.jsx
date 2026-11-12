import { Suspense } from 'react';
import StudioPage from '@/components/StudioPage';

export const metadata = { title: 'Meme Studio' };

export default function Studio() {
  return (
    <Suspense fallback={null}>
      <StudioPage />
    </Suspense>
  );
}

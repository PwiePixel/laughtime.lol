import { Suspense } from 'react';
import GalleryPage from '@/components/GalleryPage';

export const metadata = { title: 'Best memes' };

export default function Memes() {
  return (
    <Suspense fallback={null}>
      <GalleryPage />
    </Suspense>
  );
}

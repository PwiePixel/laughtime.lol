import { notFound } from 'next/navigation';
import MemePage from '@/components/MemePage';

export const metadata = { title: 'Meme' };

export default async function MemeDetail({ params }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) notFound();
  return <MemePage id={id} />;
}

import { notFound } from 'next/navigation';
import PackPage from '@/components/PackPage';

export const metadata = { title: 'Meme pack' };

export default async function Pack({ params }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(String(id || ''))) notFound();
  return <PackPage id={id} />;
}

import { notFound } from 'next/navigation';
import NewsPage from '@/components/news/NewsPage';
import { byId } from '@/lib/news';
import { newsMetadata } from '../metadata';

export async function generateMetadata({ params }) {
  const { id } = await params;
  const entry = byId(id);
  return entry ? newsMetadata(entry) : {};
}

export default async function NewsEntry({ params }) {
  const { id } = await params;
  if (!byId(id)) notFound();
  return <NewsPage id={id} />;
}

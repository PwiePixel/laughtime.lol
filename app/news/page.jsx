import NewsPage from '@/components/news/NewsPage';
import { newsMetadata } from './metadata';

export const generateMetadata = () => newsMetadata();

export default function News() {
  return <NewsPage />;
}

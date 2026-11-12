import ActivityApp from '@/components/ActivityApp';

export const metadata = {
  title: 'Discord Activity',
  robots: { index: false, follow: false },
};

export default function ActivityPage() {
  return <ActivityApp />;
}

import ActivityApp from '@/components/ActivityApp';

export const metadata = {
  title: 'Discord Activity',
  robots: { index: false, follow: false },
};

export default async function ActivityPage({ searchParams }) {
  const q = await searchParams;
  // Discord opens the frame with these parameters; without them this is a normal browser
  return <ActivityApp outside={!(q?.frame_id && q?.instance_id)} />;
}

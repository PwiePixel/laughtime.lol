import ActivityApp from '@/components/ActivityApp';
import HomeClient from '@/components/HomeClient';

export default async function HomePage({ searchParams }) {
  const q = await searchParams;
  // Discord opens the root of the URL mapping with frame_id/instance_id:
  // show the activity right here (Discord's proxy follows redirects itself,
  // so the address would stay "/" anyway)
  if (q?.frame_id && q?.instance_id) return <ActivityApp />;
  return <HomeClient />;
}

import { notFound } from 'next/navigation';
import ProfilePage from '@/components/ProfilePage';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;

export async function generateMetadata({ params }) {
  const { username } = await params;
  return { title: `@${username}` };
}

export default async function UserPage({ params }) {
  const { username } = await params;
  const name = decodeURIComponent(username);
  if (!USERNAME_RE.test(name)) notFound();
  return <ProfilePage username={name} />;
}

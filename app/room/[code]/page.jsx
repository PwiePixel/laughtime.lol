import { notFound } from 'next/navigation';
import GameRoom from '@/components/GameRoom';
import { ROOM_CODE_RE } from '@/lib/shared';
import { roomMetadata } from '../metadata';

export async function generateMetadata({ params }) {
  const { code } = await params;
  return roomMetadata(`/room/${String(code).toUpperCase()}`);
}

export default async function RoomPage({ params }) {
  const { code } = await params;
  const upper = String(code || '').toUpperCase();
  if (!ROOM_CODE_RE.test(upper)) notFound();
  return <GameRoom code={upper} />;
}

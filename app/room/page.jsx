import StoredRoom from '@/components/StoredRoom';
import { roomMetadata } from './metadata';

export async function generateMetadata() {
  return roomMetadata('/room');
}

// /room without a code: used by streamer mode (code is kept in this tab only)
export default function RoomWithoutCode() {
  return <StoredRoom />;
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ROOM_CODE_RE } from '@/lib/shared';
import { storedRoom } from '@/lib/streamer';
import GameRoom from './GameRoom';
import { useApp } from './Providers';

export default function StoredRoom() {
  const router = useRouter();
  const { t } = useApp();
  const [code, setCode] = useState(null);
  useEffect(() => {
    const c = storedRoom();
    if (ROOM_CODE_RE.test(c)) setCode(c);
    else router.replace('/');
  }, [router]);
  if (!code) return <div className="page-center">{t('common.loading')}</div>;
  return <GameRoom code={code} />;
}

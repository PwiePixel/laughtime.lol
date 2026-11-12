'use client';

import { useEffect, useState } from 'react';

const FALLBACK = { classic: { players: 0 }, hunt: { players: 0 }, huntSearches: 2, matchMin: 4, matchMax: 8, uploadMaxMb: 8 };

/** live numbers for public games (players online, hunt searches, match sizes) */
export function usePublicInfo(refreshMs = 15000) {
  const [info, setInfo] = useState(FALLBACK);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/public')
        .then((r) => r.json())
        .then((d) => alive && setInfo({ ...FALLBACK, ...d }))
        .catch(() => {});
    load();
    const id = refreshMs ? setInterval(load, refreshMs) : null;
    return () => {
      alive = false;
      if (id) clearInterval(id);
    };
  }, [refreshMs]);
  return info;
}

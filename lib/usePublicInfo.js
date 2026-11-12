'use client';

import { useMemo } from 'react';
import { useCachedFetch } from './fetchCache.js';

const FALLBACK = { classic: { players: 0 }, hunt: { players: 0 }, huntSearches: 2, matchMin: 4, matchMax: 8, uploadMaxMb: 8 };
// several components on one page ask for these numbers: one request serves them all
const FRESH_MS = 10_000;

/**
 * live numbers for public games (players online, hunt searches, match sizes).
 * refreshMs = 0 loads once; polling pauses while the tab is hidden.
 */
export function usePublicInfo(refreshMs = 15000) {
  const { data } = useCachedFetch('/api/public', { ttl: FRESH_MS, refreshMs });
  return useMemo(() => ({ ...FALLBACK, ...data }), [data]);
}

import { jsonCacheStats, outboundStats } from '../lib/outbound.js';
import { apiCache } from '../lib/respond.js';
import { proxyStats } from '../proxy.js';
import { poolStats } from './index.js';
import { searchStats } from './search.js';

/**
 * Numbers for /api/status: what goes out to the external APIs and how well the
 * caches work.
 *   outbound  per host: requests, rate limits (429), retries, failures, queue,
 *             pause and – with an hourly limit – the used budget
 *   caches    search results, media pool, media proxy (disk + picture variants),
 *             API answers and the shared JSON cache
 */
export function performanceStatus() {
  return {
    outbound: outboundStats(),
    caches: {
      search: searchStats(),
      pool: poolStats(),
      media: proxyStats(),
      api: apiCache.stats(),
      json: jsonCacheStats(),
    },
  };
}

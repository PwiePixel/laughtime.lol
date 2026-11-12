import { backoffDelay } from '../lib/outbound.js';
import { readJsonFile, writeJsonFile } from '../lib/work.js';

// ---------------------------------------------------------------------------
// The engine behind the media pool: when is which source loaded again?
//
//   - every source has its own clock: 30 minutes after a good load (± jitter,
//     so the sources do not all hit their APIs in the same second)
//   - after an error the pause doubles (5, 10, 20 … minutes, at most 6 hours)
//     and goes back to normal after the first good load
//   - the last good pool is written to disk. After a restart it is served at
//     once and every source keeps its clock – a restart does not cost a single
//     API call. An attempt is written down BEFORE the first request leaves, so
//     even a server that crashes in a loop cannot hammer an API.
// ---------------------------------------------------------------------------

export const REFRESH_MS = 30 * 60 * 1000;
export const RETRY_MS = 5 * 60 * 1000;
export const MAX_RETRY_MS = 6 * 60 * 60 * 1000;
// an attempt that never finished (crash, restart in the middle of loading)
const INTERRUPTED_MS = 60 * 1000;
const FILE_VERSION = 1;

const validItem = (item, kind) =>
  item &&
  typeof item === 'object' &&
  typeof item.id === 'string' &&
  typeof item.url === 'string' &&
  /^https:\/\//.test(item.url) &&
  item.kind === kind;

/**
 * sources: [{ key, kind, source, on(cfg) -> bool, load(cfg) -> items | null, sig?(cfg) -> string }]
 * file:    where the pool is saved – a path or a function that returns one (null = memory only)
 * allow:   (item, cfg) -> bool, e.g. the blocked words filter
 * beforeRefresh: called once before a round of loading (housekeeping)
 */
export function createMediaPool({
  sources,
  file = null,
  getCfg = () => ({}),
  allow = () => true,
  refreshMs = REFRESH_MS,
  retryMs = RETRY_MS,
  maxRetryMs = MAX_RETRY_MS,
  interruptedMs = INTERRUPTED_MS,
  jitter = 0.1,
  beforeRefresh = () => {},
  log = console,
} = {}) {
  // key -> { items, status: 'off'|'ok'|'error'|'loading', error, updatedAt, failures, nextAt, restored }
  const entries = new Map(
    sources.map((s) => [s.key, { items: [], status: 'loading', error: null, updatedAt: 0, failures: 0, nextAt: 0, restored: false, sig: '' }]),
  );
  let timer = null;
  let started = null;
  let stopped = false;
  let saving = Promise.resolve();
  const counts = { refreshes: 0, loads: 0, errors: 0, restoredItems: 0, savedAt: 0 };

  const filePath = () => (typeof file === 'function' ? file() : file);
  const jittered = (ms) => Math.round(ms * (1 + (Math.random() * 2 - 1) * jitter));
  const sigOf = (src, cfg) => (src.sig ? String(src.sig(cfg)) : '');
  const isOn = (src, cfg) => (src.on ? Boolean(src.on(cfg)) : true);

  function save() {
    const target = filePath();
    if (!target) return saving;
    saving = saving
      .then(() => {
        const data = { v: FILE_VERSION, savedAt: Date.now(), sources: {} };
        for (const [key, e] of entries) {
          if (e.status === 'off') continue;
          data.sources[key] = { items: e.items, updatedAt: e.updatedAt, failures: e.failures, nextAt: e.nextAt, error: e.error, sig: e.sig };
        }
        counts.savedAt = data.savedAt;
        return writeJsonFile(target, data);
      })
      .catch((err) => log.warn(`[media] could not save the pool: ${err.message}`));
    return saving;
  }

  /** Load the saved pool. Returns the number of items that are usable right away. */
  async function restore() {
    const source = filePath();
    if (!source) return 0;
    const data = await readJsonFile(source);
    if (!data || data.v !== FILE_VERSION || !data.sources || typeof data.sources !== 'object') return 0;
    const cfg = getCfg();
    const now = Date.now();
    let total = 0;
    for (const src of sources) {
      const saved = data.sources[src.key];
      const e = entries.get(src.key);
      if (!saved || typeof saved !== 'object' || !isOn(src, cfg)) continue; // switched off since: do not serve it any more
      const seen = new Set();
      const items = (Array.isArray(saved.items) ? saved.items : []).filter(
        (i) => validItem(i, src.kind) && allow(i, cfg) && !seen.has(i.id) && seen.add(i.id),
      );
      const failures = Math.max(0, Math.floor(Number(saved.failures) || 0));
      if (!items.length && !failures) continue; // nothing worth keeping: load now
      e.items = items;
      e.status = items.length ? 'ok' : 'error';
      e.error = typeof saved.error === 'string' ? saved.error : items.length ? null : 'the last attempt did not finish';
      e.updatedAt = Number(saved.updatedAt) || 0;
      e.failures = failures;
      e.restored = items.length > 0;
      e.sig = sigOf(src, cfg);
      // keep the clock – unless the settings of this source changed or the time makes no sense
      const nextAt = Number(saved.nextAt) || 0;
      const sameSettings = String(saved.sig || '') === e.sig;
      e.nextAt = sameSettings && nextAt <= now + maxRetryMs * (1 + jitter) ? nextAt : 0;
      total += items.length;
    }
    counts.restoredItems = total;
    return total;
  }

  async function refreshSource(src, cfg) {
    const e = entries.get(src.key);
    counts.loads += 1;
    try {
      const items = await src.load(cfg);
      if (items === null) {
        Object.assign(e, { status: 'off', items: [], error: null, failures: 0, nextAt: Date.now() + refreshMs });
        return;
      }
      const seen = new Set();
      const clean = items.filter((i) => i && i.url && allow(i, cfg) && !seen.has(i.id) && seen.add(i.id));
      if (!clean.length) throw new Error('no items returned');
      Object.assign(e, { items: clean, status: 'ok', error: null, updatedAt: Date.now(), failures: 0, restored: false });
      e.nextAt = Date.now() + jittered(refreshMs);
    } catch (err) {
      counts.errors += 1;
      // the old items stay in the game; the next attempt comes later every time
      e.status = e.items.length ? 'ok' : 'error';
      e.error = String(err?.message || err);
      const pause = backoffDelay(e.failures, { baseMs: retryMs, maxMs: maxRetryMs, jitter });
      e.nextAt = Date.now() + pause;
      log.warn(`[media] ${src.key}: ${e.error} (attempt ${e.failures}, next one in ${Math.round(pause / 60000)} min)`);
    }
  }

  /** Load every source whose time has come (force: all of them). Returns the keys that were loaded. */
  async function refreshDue({ force = false } = {}) {
    const cfg = getCfg();
    const now = Date.now();
    const due = [];
    for (const src of sources) {
      const e = entries.get(src.key);
      if (!isOn(src, cfg)) {
        Object.assign(e, { status: 'off', items: [], error: null, failures: 0, nextAt: now + refreshMs });
        continue;
      }
      if (!force && e.nextAt > now + 1000) continue;
      // Written down first: if the process dies during loading, the next start
      // sees an attempt without result and waits instead of asking again.
      e.failures += 1;
      e.nextAt = now + backoffDelay(e.failures, { baseMs: interruptedMs, maxMs: maxRetryMs, jitter });
      e.sig = sigOf(src, cfg);
      if (e.status === 'off') e.status = 'loading';
      due.push(src);
    }
    if (!due.length) return [];
    counts.refreshes += 1;
    beforeRefresh();
    await save();
    await Promise.all(due.map((src) => refreshSource(src, cfg)));
    await save();
    const summary = sources
      .map((s) => {
        const e = entries.get(s.key);
        return `${s.key}=${e.status === 'ok' ? e.items.length : e.status}`;
      })
      .join('  ');
    log.log(`[media] ${summary}`);
    return due.map((s) => s.key);
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    let next = Infinity;
    for (const e of entries.values()) if (e.nextAt < next) next = e.nextAt;
    const wait = Math.max(1000, Math.min(next - Date.now(), maxRetryMs));
    timer = setTimeout(() => {
      refreshDue()
        .catch((err) => log.warn(`[media] refresh failed: ${err.message}`))
        .finally(schedule);
    }, wait);
    timer.unref?.();
  }

  const hasBoth = () => {
    const kinds = new Set();
    for (const src of sources) if (entries.get(src.key).items.length) kinds.add(src.kind);
    return kinds.has('image') && kinds.has('video');
  };

  return {
    entries,
    restore,
    refreshDue,
    save,
    /**
     * Start the background loading. The returned promise resolves as soon as
     * there is something to play with: at once with a saved pool, otherwise
     * after the first round of loading.
     */
    start() {
      if (started) return started;
      stopped = false;
      started = (async () => {
        const restored = await restore().catch(() => 0);
        if (restored) log.log(`[media] ${restored} items from the saved pool – no API round needed`);
        const first = refreshDue()
          .catch((err) => log.warn(`[media] refresh failed: ${err.message}`))
          .finally(schedule);
        if (!hasBoth()) await first;
      })();
      return started;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      started = null;
    },
    stats: () => ({ ...counts }),
  };
}

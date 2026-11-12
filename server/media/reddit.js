import { dedupe } from '../lib/outbound.js';
import { fetchWithTimeout, getJson } from './http.js';

// Reddit – works without credentials from many hosts. Reddit blocks a lot of
// data-centre IPs though, so REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET enable the
// official application-only OAuth API (oauth.reddit.com), which is reliable.

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
// a new token is requested this long before the old one runs out
const TOKEN_MARGIN_MS = 60_000;
// after a failed login (wrong secret, Reddit down) wait before asking again
const TOKEN_RETRY_MS = 5 * 60_000;

let token = null;
let tokenExpires = 0;
let tokenFailedAt = 0;
let tokenError = null;

/**
 * App-only OAuth token: kept in memory until shortly before it expires. All
 * listings that start at the same time share one token request, and a failed
 * login is not repeated for a few minutes.
 */
async function getToken(cfg, tokenUrl = TOKEN_URL) {
  if (!cfg.redditClientId || !cfg.redditClientSecret) return null;
  if (token && Date.now() < tokenExpires - TOKEN_MARGIN_MS) return token;
  if (tokenError && Date.now() - tokenFailedAt < TOKEN_RETRY_MS) throw tokenError;
  return dedupe('reddit:token', async () => {
    try {
      const res = await fetchWithTimeout(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${cfg.redditClientId}:${cfg.redditClientSecret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': cfg.redditUserAgent,
        },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) {
        res.body?.cancel().catch(() => {});
        throw Object.assign(new Error(`Reddit OAuth HTTP ${res.status}`), { status: res.status });
      }
      const json = await res.json();
      if (!json?.access_token) throw new Error('Reddit OAuth: no token in the answer');
      token = json.access_token;
      tokenExpires = Date.now() + (Number(json.expires_in) > 0 ? Number(json.expires_in) : 3600) * 1000;
      tokenError = null;
      return token;
    } catch (err) {
      token = null;
      tokenError = err;
      tokenFailedAt = Date.now();
      throw err;
    }
  });
}

async function listing(cfg, sub, sort = 'hot') {
  const t = await getToken(cfg);
  const url = t
    ? `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/${sort}?limit=75&raw_json=1${sort === 'top' ? '&t=month' : ''}`
    : `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}.json?limit=75&raw_json=1${sort === 'top' ? '&t=month' : ''}`;
  const headers = { 'User-Agent': cfg.redditUserAgent };
  if (t) headers.Authorization = `Bearer ${t}`;
  const json = await getJson(url, { headers });
  return (json?.data?.children || []).map((c) => c.data).filter(Boolean);
}

const okPost = (p, cfg) =>
  !p.over_18 && !p.spoiler && !p.stickied && !cfg.blockedWords.some((w) => String(p.title || '').toLowerCase().includes(w));

function toVideo(p, cfg) {
  const src = p.crosspost_parent_list?.[0] || p;
  const v = src.secure_media?.reddit_video || src.media?.reddit_video || src.preview?.reddit_video_preview;
  if (!v?.fallback_url) return null;
  if (v.duration && v.duration > cfg.maxVideoSeconds) return null;
  return {
    id: `reddit:${p.id}`,
    kind: 'video',
    url: v.fallback_url.replace(/\?.*$/, ''),
    width: v.width || 480,
    height: v.height || 480,
    title: p.title,
    source: 'reddit',
    link: `https://www.reddit.com${p.permalink}`,
  };
}

function toImage(p) {
  if (!/^https:\/\/i\.redd\.it\/[^/]+\.(jpe?g|png)$/i.test(p.url || '')) return null;
  const s = p.preview?.images?.[0]?.source;
  return {
    id: `reddit:${p.id}`,
    kind: 'image',
    url: p.url,
    width: s?.width || 800,
    height: s?.height || 800,
    title: p.title,
    source: 'reddit',
    link: `https://www.reddit.com${p.permalink}`,
  };
}

// answers that mean "this server is not welcome": more requests would only make it worse
const BLOCKED = new Set([401, 403, 429]);

async function collect(cfg, subs, mapper) {
  const calls = subs.flatMap((s) => [() => listing(cfg, s, 'hot'), () => listing(cfg, s, 'top')]);
  if (!calls.length) return [];
  // One listing first: when Reddit blocks this server, the remaining requests are not sent at all.
  const [first] = await Promise.allSettled([calls[0]()]);
  if (first.status === 'rejected' && (BLOCKED.has(first.reason?.status) || first.reason?.code)) throw first.reason;
  const results = [first, ...(await Promise.allSettled(calls.slice(1).map((call) => call())))];
  const items = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const p of r.value) {
      if (!okPost(p, cfg)) continue;
      const item = mapper(p, cfg);
      if (item) items.push(item);
    }
  }
  if (!items.length && results.length && results.every((r) => r.status === 'rejected')) throw results[0].reason;
  return items;
}

export async function loadRedditVideos(cfg) {
  if (!cfg.redditEnabled || !cfg.redditVideoSubs.length) return null;
  return collect(cfg, cfg.redditVideoSubs, toVideo);
}

export async function loadRedditImages(cfg) {
  if (!cfg.redditEnabled || !cfg.redditImageSubs.length) return null;
  return collect(cfg, cfg.redditImageSubs, toImage);
}

/** only for tests */
export const _test = {
  getToken,
  resetToken() {
    token = null;
    tokenExpires = 0;
    tokenFailedAt = 0;
    tokenError = null;
  },
};

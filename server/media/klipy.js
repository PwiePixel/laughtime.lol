import { getJson, pickSome } from './http.js';

// KLIPY – free GIF & clip API (replacement for the discontinued Tenor API).
// Free app key: https://partner.klipy.com  ->  KLIPY_API_KEY
// Uses two content types:
//   clips – short movie/TV clips (max. ~10 s)
//   gifs  – classic reaction GIFs, delivered as MP4
const FILTER = { g: 'high', pg: 'medium', 'pg-13': 'medium', r: 'low' };

const num = (v, d) => (Number(v) > 0 ? Number(v) : d);

function pickFile(file) {
  if (!file) return null;
  // clips: { mp4: "https://…" }  |  gifs: { hd: { mp4: { url, width, height } }, md: …, sm: … }
  if (typeof file.mp4 === 'string') return { url: file.mp4 };
  if (file.mp4?.url) return file.mp4;
  for (const size of ['hd', 'md', 'sm', 'xs']) {
    const f = file[size]?.mp4;
    if (typeof f === 'string') return { url: f };
    if (f?.url) return f;
  }
  return null;
}

// a still image for the studio grid (KLIPY sends jpg/webp/png renditions next to the mp4)
function stillOf(file) {
  for (const size of ['sm', 'xs', 'md']) {
    for (const fmt of ['jpg', 'webp', 'png']) {
      const f = file?.[size]?.[fmt];
      const url = typeof f === 'string' ? f : f?.url;
      if (url && /^https:\/\//.test(url)) return url;
    }
  }
  return null;
}

export function toItem(raw, kind) {
  if (!raw || raw.type === 'ad') return null;
  const f = pickFile(raw.file);
  if (!f?.url || !/^https:\/\//.test(f.url)) return null;
  const meta = raw.file_meta?.mp4 || {};
  const key = raw.id ?? raw.slug;
  if (key === undefined) return null;
  return {
    id: `klipy:${kind}:${key}`,
    kind: 'video',
    url: f.url,
    width: num(f.width, num(meta.width, 480)),
    height: num(f.height, num(meta.height, 270)),
    title: raw.title || 'KLIPY',
    thumb: stillOf(raw.file),
    source: 'klipy',
    link: raw.url || (raw.slug ? `https://klipy.com/${kind}/${raw.slug}` : 'https://klipy.com'),
  };
}

export const klipyBase = (cfg) => `${cfg.klipyApiBase || 'https://api.klipy.com/api/v1'}/${encodeURIComponent(cfg.klipyKey)}`;
export const klipyParams = (cfg, perPage) =>
  `per_page=${perPage}&customer_id=${encodeURIComponent(cfg.klipyCustomerId)}` +
  `&locale=${encodeURIComponent(cfg.klipyLocale)}&content_filter=${FILTER[cfg.contentRating] || 'medium'}`;

/** list inside a KLIPY response ({ data: { data: [...] } } or { data: [...] }) */
export const klipyList = (json) => {
  const list = json?.data?.data || json?.data || [];
  return Array.isArray(list) ? list : [];
};

export async function loadKlipyVideos(cfg) {
  if (!cfg.klipyKey) return null;
  const base = klipyBase(cfg);
  const common = klipyParams(cfg, 50);
  const requests = [];
  for (const kind of cfg.klipyTypes) {
    requests.push({ kind, url: `${base}/${kind}/trending?${common}` });
    for (const term of pickSome(cfg.searchTerms, 2)) {
      const page = 1 + Math.floor(Math.random() * 3);
      requests.push({ kind, url: `${base}/${kind}/search?${common}&page=${page}&q=${encodeURIComponent(term)}` });
    }
  }
  const results = await Promise.allSettled(requests.map((r) => getJson(r.url)));
  const items = [];
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    for (const raw of klipyList(r.value)) {
      const item = toItem(raw, requests[i].kind);
      if (item) items.push(item);
    }
  });
  if (!items.length && results.length && results.every((r) => r.status === 'rejected')) {
    // do not leak the key into the log
    throw new Error(String(results[0].reason?.message || results[0].reason).replace(cfg.klipyKey, '***'));
  }
  return items;
}

export const _test = { toItem };

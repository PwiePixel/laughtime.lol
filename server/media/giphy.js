import { getJson, pickSome } from './http.js';

// GIPHY – needs a free API key (GIPHY_API_KEY): https://developers.giphy.com/dashboard/
// GIFs are used as silent MP4.
export function giphyItem(g) {
  const img = g?.images || {};
  const rend = [img.original_mp4, img.original, img.downsized_small, img.fixed_height].find((x) => x?.mp4);
  if (!rend || !/^https:\/\//.test(rend.mp4)) return null;
  return {
    id: `giphy:${g.id}`,
    kind: 'video',
    url: rend.mp4,
    width: Number(rend.width) || Number(img.original?.width) || 480,
    height: Number(rend.height) || Number(img.original?.height) || 270,
    title: g.title || 'GIPHY clip',
    thumb: [img['480w_still'], img.fixed_height_still, img.original_still].find((x) => x?.url)?.url || null,
    source: 'giphy',
    link: g.url,
  };
}

export const giphyBase = (cfg) => cfg.giphyApiBase || 'https://api.giphy.com/v1/gifs';

export async function loadGiphyVideos(cfg) {
  if (!cfg.giphyKey) return null;
  const base = giphyBase(cfg);
  const common = `api_key=${encodeURIComponent(cfg.giphyKey)}&limit=50&rating=${cfg.contentRating}&bundle=messaging_non_clips`;
  const urls = [`${base}/trending?${common}`];
  for (const term of pickSome(cfg.searchTerms, 4)) {
    urls.push(`${base}/search?${common}&lang=en&q=${encodeURIComponent(term)}&offset=${Math.floor(Math.random() * 100)}`);
  }
  const results = await Promise.allSettled(urls.map((u) => getJson(u)));
  const items = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const g of r.value?.data || []) {
      const item = giphyItem(g);
      if (item) items.push(item);
    }
  }
  if (!items.length && results.every((r) => r.status === 'rejected')) throw results[0].reason;
  return items;
}

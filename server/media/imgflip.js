import { decodeHtml, getJson, getText } from './http.js';

// Imgflip: the public API lists the top 100 image templates (no key needed).
// More image templates and the animated GIF templates (served as MP4) are read
// from the public template pages.

const b36 = (id) => Number(id).toString(36);

function parseTemplatePage(html, kind) {
  const out = [];
  const boxes = html.split('class="mt-box"').slice(1);
  for (const box of boxes) {
    const link = box.match(/href="\/(?:meme|memetemplate)\/(\d+)\/[^"]*">([^<]+)<\/a>/);
    const img = box.match(/src="\/\/i\.imgflip\.com\/\d+\/([a-z0-9]+)\.(jpg|jpeg|png|gif)"/i);
    const thumbPath = box.match(/src="\/\/(i\.imgflip\.com\/\d+\/[a-z0-9]+\.(?:jpg|jpeg|png|gif))"/i)?.[1];
    const size = box.match(/style="width:([\d.]+)px;height:([\d.]+)px"/);
    if (!link || !img) continue;
    const animated = box.includes('mt-animated-label');
    if (kind === 'video' && !animated) continue;
    if (kind === 'image' && animated) continue;
    const width = size ? Math.round(Number(size[1]) * 4) : 600;
    const height = size ? Math.round(Number(size[2]) * 4) : 600;
    const code = img[1];
    out.push({
      id: `imgflip:${link[1]}`,
      kind,
      url: kind === 'video' ? `https://i.imgflip.com/${code}.mp4` : `https://i.imgflip.com/${code}.${img[2].toLowerCase()}`,
      thumb: thumbPath ? `https://${thumbPath}` : null,
      width,
      height,
      title: decodeHtml(link[2]).trim(),
      source: 'imgflip',
      link: kind === 'video' ? `https://imgflip.com/gif-maker/${link[1]}` : `https://imgflip.com/memegenerator/${link[1]}`,
    });
  }
  return out;
}

export async function loadImgflipImages(cfg) {
  const items = [];
  const api = await getJson('https://api.imgflip.com/get_memes');
  for (const m of api?.data?.memes || []) {
    if (!m.url || !/\.(jpe?g|png)$/i.test(m.url)) continue;
    items.push({
      id: `imgflip:${m.id}`,
      kind: 'image',
      url: m.url.replace(/^http:/, 'https:'),
      width: m.width,
      height: m.height,
      title: m.name,
      boxCount: m.box_count,
      source: 'imgflip',
      link: `https://imgflip.com/memegenerator/${m.id}`,
    });
  }
  const pages = Math.max(0, cfg.imgflipPages - 2);
  const results = await Promise.allSettled(
    Array.from({ length: pages }, (_, i) =>
      getText(`https://imgflip.com/memetemplates?page=${i + 3}`).then((h) => parseTemplatePage(h, 'image')),
    ),
  );
  for (const r of results) if (r.status === 'fulfilled') items.push(...r.value);
  return items;
}

export async function loadImgflipVideos(cfg) {
  const results = await Promise.allSettled(
    Array.from({ length: cfg.imgflipPages }, (_, i) =>
      getText(`https://imgflip.com/gif-templates${i ? `?page=${i + 1}` : ''}`).then((h) => parseTemplatePage(h, 'video')),
    ),
  );
  const items = [];
  for (const r of results) if (r.status === 'fulfilled') items.push(...r.value);
  if (!items.length) {
    const err = results.find((r) => r.status === 'rejected');
    if (err) throw err.reason;
  }
  return items;
}

export const _test = { parseTemplatePage, b36 };

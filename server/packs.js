import { PACK_LIMITS } from '../lib/shared.js';
import { getUserById, isAdmin, publicUser } from './accounts.js';
import { all, get, newId, run, transaction } from './db.js';
import { HttpError } from './http.js';
import { isAllowedUrl, proxyUrl } from './proxy.js';
import { findKnownItem, isBlocked } from './media/search.js';
import { getConfig } from './config.js';
import { removeFile, storeFile, uploadMedia } from './uploads.js';
import { notifyModerators } from './webhook.js';

// ---------------------------------------------------------------------------
// Meme Studio: players with an account collect templates & clips into packs
// (from the search / template pool) or upload their own pictures & GIFs.
// Packs made only from our sources can be public right away; packs with
// own uploads become public only after an admin approved them.
// ---------------------------------------------------------------------------

const ch = (n) => String.fromCharCode(n);
const CTRL = new RegExp(`[${ch(0)}-${ch(31)}${ch(127)}<>]`, 'g');

function cleanText(v, max) {
  return String(v ?? '')
    .replace(CTRL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function validName(v) {
  const name = cleanText(v, PACK_LIMITS.name);
  if (name.length < 2) throw new HttpError(400, 'pack_name_required');
  if (isBlocked(name)) throw new HttpError(400, 'pack_name_blocked');
  return name;
}

function validDescription(v) {
  const d = cleanText(v, PACK_LIMITS.description);
  if (isBlocked(d)) throw new HttpError(400, 'pack_name_blocked');
  return d;
}

/** "/api/uploads/packs/abc.gif" -> "/api/uploads/t/packs/abc.webp" */
const localThumb = (url) => {
  const m = /^\/api\/uploads\/(packs|rooms)\/([A-Za-z0-9_-]{16,40})\.(png|jpg|gif|webp)$/.exec(String(url || ''));
  return m ? `/api/uploads/t/${m[1]}/${m[2]}.webp` : null;
};

const mediaJson = (m) =>
  JSON.stringify({
    id: m.id,
    kind: m.kind,
    url: m.url,
    thumb: m.thumb || null,
    local: m.local || undefined,
    uploadId: m.uploadId || undefined,
    animated: m.animated || undefined,
    width: m.width,
    height: m.height,
    title: m.title,
    source: m.source,
    link: m.link,
  });

function publicMedia(raw) {
  if (!raw) return null;
  const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return {
    id: m.id,
    kind: m.kind,
    src: m.local ? m.url : proxyUrl(m.url),
    // eigene Uploads: Vorschau aus der Adresse ableiten – so sind auch Dateien
    // von früher sofort schnell, ohne dass etwas nachgetragen werden muss
    thumb: m.local ? m.thumb || localThumb(m.url) : (m.thumb && isAllowedUrl(m.thumb) ? proxyUrl(m.thumb) : null),
    upload: Boolean(m.uploadId),
    animated: Boolean(m.animated),
    width: m.width,
    height: m.height,
    title: m.title,
    source: m.source,
    link: m.link,
  };
}

const unapprovedCount = (packId) =>
  get(
    `SELECT COUNT(*) AS n FROM pack_items pi JOIN uploads u ON pi.media_id = 'upload:' || u.id
     WHERE pi.pack_id = ? AND u.approved = 0`,
    packId,
  )?.n ?? 0;

function toJson(row, viewer, items) {
  const owner = row.username ? { username: row.username, displayName: row.display_name, avatar: row.avatar } : publicUser(getUserById(row.user_id));
  const out = {
    id: row.id,
    name: row.name,
    description: row.description,
    public: Boolean(row.public),
    plays: Number(row.plays),
    itemCount: Number(row.item_count),
    playable: Number(row.item_count) >= PACK_LIMITS.minItems,
    cover: row.cover ? publicMedia(row.cover) : null,
    owner,
    isMine: Boolean(viewer && viewer.id === row.user_id),
    uploadCount: Number(row.upload_count || 0),
    review: row.review || 'none',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const canManage = viewer && (viewer.id === row.user_id || isAdmin(viewer));
  if (canManage) {
    out.reviewNote = row.review_note || '';
    out.needsReview = unapprovedCount(row.id) > 0;
  }
  if (items) {
    const approved = new Set(
      all(
        `SELECT u.id FROM pack_items pi JOIN uploads u ON pi.media_id = 'upload:' || u.id WHERE pi.pack_id = ? AND u.approved = 1`,
        row.id,
      ).map((r) => r.id),
    );
    out.items = items.map((i) => {
      const m = publicMedia(i.media);
      if (m.upload) m.approved = approved.has(m.id.slice(7));
      return m;
    });
  }
  return out;
}

const SELECT = `SELECT p.*, u.username, u.display_name, u.avatar FROM packs p JOIN users u ON u.id = p.user_id`;

function loadPack(id) {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(String(id || ''))) return null;
  return get(`${SELECT} WHERE p.id = ?`, String(id));
}

function ownPack(id, user) {
  const row = loadPack(id);
  if (!row) throw new HttpError(404, 'pack_not_found');
  if (row.user_id !== user.id && !isAdmin(user)) throw new HttpError(403, 'forbidden');
  return row;
}

function refreshMeta(id) {
  const count = get('SELECT COUNT(*) AS n FROM pack_items WHERE pack_id = ?', id)?.n ?? 0;
  const uploads = get("SELECT COUNT(*) AS n FROM pack_items WHERE pack_id = ? AND media_id LIKE 'upload:%'", id)?.n ?? 0;
  const first = get('SELECT media FROM pack_items WHERE pack_id = ? ORDER BY added_at ASC LIMIT 1', id);
  run(
    'UPDATE packs SET item_count = ?, upload_count = ?, cover = ?, updated_at = ? WHERE id = ?',
    count,
    uploads,
    first?.media ?? null,
    Date.now(),
    id,
  );
  // a public pack must not show unreviewed uploads
  const row = get('SELECT public, review FROM packs WHERE id = ?', id);
  if (row?.public && unapprovedCount(id) > 0) {
    run("UPDATE packs SET public = 0, review = 'pending', review_note = '' WHERE id = ?", id);
    notifyModerators('pack_review');
  } else if (row && row.review === 'pending' && unapprovedCount(id) === 0) {
    // nothing left to review (uploads removed): public again
    run("UPDATE packs SET public = 1, review = 'none' WHERE id = ?", id);
  }
}

/** deletes upload rows + files that are no longer used in any pack */
function dropOrphanUploads(uploadIds) {
  for (const id of uploadIds) {
    const used = get('SELECT 1 AS x FROM pack_items WHERE media_id = ?', `upload:${id}`);
    if (used) continue;
    const row = get('SELECT file FROM uploads WHERE id = ?', id);
    if (!row) continue;
    run('DELETE FROM uploads WHERE id = ?', id);
    removeFile(row.file);
  }
}

const uploadIdsOf = (packId) =>
  all("SELECT media_id FROM pack_items WHERE pack_id = ? AND media_id LIKE 'upload:%'", packId).map((r) => r.media_id.slice(7));

// --- queries -------------------------------------------------------------------

export function listPacks({ scope = 'public', viewer = null, q = '', limit = 24, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(60, Number(limit) || 24));
  const off = Math.max(0, Math.min(5000, Number(offset) || 0));
  const search = cleanText(q, 40);
  const like = `%${search.replace(/[%_]/g, '')}%`;
  let rows;
  if (scope === 'mine') {
    if (!viewer) throw new HttpError(401, 'login_required');
    rows = all(`${SELECT} WHERE p.user_id = ? AND p.name LIKE ? ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, viewer.id, like, lim + 1, off);
  } else {
    rows = all(
      `${SELECT} WHERE p.public = 1 AND p.item_count >= ? AND (p.name LIKE ? OR u.username LIKE ?)
       ORDER BY p.plays DESC, p.item_count DESC, p.updated_at DESC LIMIT ? OFFSET ?`,
      PACK_LIMITS.minItems,
      like,
      like,
      lim + 1,
      off,
    );
  }
  return { items: rows.slice(0, lim).map((r) => toJson(r, viewer)), more: rows.length > lim };
}

export function getPack(id, viewer) {
  const row = loadPack(id);
  if (!row || (!row.public && row.user_id !== viewer?.id && !isAdmin(viewer))) throw new HttpError(404, 'pack_not_found');
  const items = all('SELECT media FROM pack_items WHERE pack_id = ? ORDER BY added_at ASC', row.id);
  return toJson(row, viewer, items);
}

// --- changes -------------------------------------------------------------------

export function createPack(user, body = {}) {
  const count = get('SELECT COUNT(*) AS n FROM packs WHERE user_id = ?', user.id)?.n ?? 0;
  if (count >= PACK_LIMITS.packs) throw new HttpError(400, 'pack_limit', { max: PACK_LIMITS.packs });
  const id = newId(8);
  const t = Date.now();
  run(
    'INSERT INTO packs (id, user_id, name, description, public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    user.id,
    validName(body.name),
    validDescription(body.description),
    body.public === false ? 0 : 1,
    t,
    t,
  );
  return getPack(id, user);
}

export function updatePack(id, user, body = {}) {
  const row = ownPack(id, user);
  const fields = {};
  if (body.name !== undefined) fields.name = validName(body.name);
  if (body.description !== undefined) fields.description = validDescription(body.description);
  if (body.public !== undefined) {
    if (body.public && unapprovedCount(row.id) > 0) {
      // own uploads: an admin has to approve first
      fields.public = 0;
      fields.review = 'pending';
      fields.review_note = '';
      if (row.review !== 'pending') notifyModerators('pack_review');
    } else {
      fields.public = body.public ? 1 : 0;
      if (!body.public && row.review === 'pending') fields.review = 'none';
    }
  }
  const keys = Object.keys(fields);
  if (keys.length) {
    run(
      `UPDATE packs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      ...keys.map((k) => fields[k]),
      Date.now(),
      row.id,
    );
  }
  return getPack(row.id, user);
}

export function deletePack(id, user) {
  const row = ownPack(id, user);
  const uploads = uploadIdsOf(row.id);
  run('DELETE FROM packs WHERE id = ?', row.id);
  dropOrphanUploads(uploads);
  return { ok: true };
}

/** own picture / GIF into a pack (file already checked by readUpload) */
export async function addPackUpload(id, user, { buf, info, name }) {
  const row = ownPack(id, user);
  const count = get('SELECT COUNT(*) AS n FROM pack_items WHERE pack_id = ?', row.id)?.n ?? 0;
  if (count >= PACK_LIMITS.items) throw new HttpError(400, 'pack_full', { max: PACK_LIMITS.items });
  const mine = get('SELECT COUNT(*) AS n FROM uploads WHERE user_id = ?', user.id)?.n ?? 0;
  if (mine >= getConfig().uploadsPerUser) throw new HttpError(400, 'upload_limit', { max: getConfig().uploadsPerUser });
  if (name && isBlocked(name)) name = '';
  const stored = await storeFile('packs', buf, info);
  const media = uploadMedia({ id: stored.id, url: stored.url, thumb: stored.thumb, info, name });
  // uploads by admins are approved right away
  const approved = isAdmin(user) ? 1 : 0;
  try {
    transaction(() => {
    run(
      `INSERT INTO uploads (id, user_id, file, mime, size, width, height, animated, name, approved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      stored.id,
      user.id,
      stored.rel,
      info.mime,
      buf.length,
      info.width,
      info.height,
      info.animated ? 1 : 0,
      name || '',
      approved,
      Date.now(),
    );
    run(
      'INSERT INTO pack_items (pack_id, media_id, kind, media, added_at) VALUES (?, ?, ?, ?, ?)',
      row.id,
      media.id,
      media.kind,
      mediaJson(media),
      Date.now(),
    );
    refreshMeta(row.id);
    });
  } catch (err) {
    removeFile(stored.rel);
    throw err;
  }
  return getPack(row.id, user);
}

// --- admin review ----------------------------------------------------------------

export function listReviews(admin) {
  if (!isAdmin(admin)) throw new HttpError(403, 'forbidden');
  const rows = all(`${SELECT} WHERE p.review = 'pending' ORDER BY p.updated_at ASC LIMIT 50`);
  return rows.map((r) => getPack(r.id, admin));
}

export function reviewPack(id, admin, { approve, note = '' } = {}) {
  if (!isAdmin(admin)) throw new HttpError(403, 'forbidden');
  const row = loadPack(id);
  if (!row) throw new HttpError(404, 'pack_not_found');
  const cleanNote = cleanText(note, 200);
  transaction(() => {
    if (approve) {
      for (const uid of uploadIdsOf(row.id)) run('UPDATE uploads SET approved = 1 WHERE id = ?', uid);
      run("UPDATE packs SET public = 1, review = 'approved', review_note = ?, updated_at = ? WHERE id = ?", cleanNote, Date.now(), row.id);
    } else {
      run("UPDATE packs SET public = 0, review = 'rejected', review_note = ?, updated_at = ? WHERE id = ?", cleanNote, Date.now(), row.id);
    }
  });
  return getPack(row.id, admin);
}

export function addPackItem(id, user, mediaId) {
  const row = ownPack(id, user);
  const item = findKnownItem(String(mediaId || ''));
  if (!item || !isAllowedUrl(item.url)) throw new HttpError(400, 'item_expired');
  if (isBlocked(item.title)) throw new HttpError(400, 'item_blocked');
  return transaction(() => {
    const count = get('SELECT COUNT(*) AS n FROM pack_items WHERE pack_id = ?', row.id)?.n ?? 0;
    if (count >= PACK_LIMITS.items) throw new HttpError(400, 'pack_full', { max: PACK_LIMITS.items });
    run(
      'INSERT OR IGNORE INTO pack_items (pack_id, media_id, kind, media, added_at) VALUES (?, ?, ?, ?, ?)',
      row.id,
      item.id,
      item.kind,
      mediaJson(item),
      Date.now(),
    );
    refreshMeta(row.id);
    return getPack(row.id, user);
  });
}

export function removePackItem(id, user, mediaId) {
  const row = ownPack(id, user);
  const mid = String(mediaId || '');
  run('DELETE FROM pack_items WHERE pack_id = ? AND media_id = ?', row.id, mid);
  refreshMeta(row.id);
  if (mid.startsWith('upload:')) dropOrphanUploads([mid.slice(7)]);
  return getPack(row.id, user);
}

// --- used by the game server --------------------------------------------------

/** returns { id, name, count } if the host may play this pack, otherwise an error code */
export function packForGame(id, userId) {
  const row = loadPack(id);
  if (!row) return { error: 'pack_not_found' };
  if (!row.public && row.user_id !== userId) return { error: 'pack_not_found' };
  if (row.item_count < PACK_LIMITS.minItems) return { error: 'pack_too_small' };
  return { id: row.id, name: row.name, count: Number(row.item_count), owner: row.display_name };
}

/** media objects of a pack (server side, with real URLs) */
export function packItemsForGame(id) {
  return all('SELECT media FROM pack_items WHERE pack_id = ?', String(id))
    .map((r) => {
      try {
        return JSON.parse(r.media);
      } catch {
        return null;
      }
    })
    .filter((m) => m && (m.local ? /^\/api\/uploads\/packs\//.test(m.url) : isAllowedUrl(m.url)));
}

export function countPackPlay(id) {
  run('UPDATE packs SET plays = plays + 1 WHERE id = ?', String(id));
}

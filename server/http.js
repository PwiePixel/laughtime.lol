// Small HTTP helpers for the custom server (no framework needed).

export function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function redirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export async function readJson(req, limit = 16 * 1024) {
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/json')) throw new HttpError(415, 'json_required');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too_large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge !== undefined) c += `; Max-Age=${Math.floor(maxAge)}`;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  return c;
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd =
      req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0];
    if (fwd) return String(fwd).trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function isHttps(req, trustProxy) {
  if (req.socket.encrypted) return true;
  return trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

/** Host of our own Discord Activity frame (requests arrive through Discord's proxy). */
export function activityProxyHost() {
  const id = process.env.DISCORD_CLIENT_ID;
  if (!id || !process.env.DISCORD_CLIENT_SECRET || process.env.ACTIVITY_ENABLED === 'false') return '';
  return `${id}.discordsays.com`.toLowerCase();
}

/** Rejects cross-site form/JSON posts (browsers always send Origin on POST). */
export function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    const o = new URL(origin);
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (o.host !== host && o.host.toLowerCase() !== activityProxyHost()) throw new HttpError(403, 'bad_origin');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(403, 'bad_origin');
  }
}

/** Sliding-window rate limiter kept in memory. */
export function createLimiter({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, list] of hits) {
      const recent = list.filter((t) => t > cutoff);
      if (recent.length) hits.set(k, recent);
      else hits.delete(k);
    }
  }, windowMs);
  timer.unref?.();
  return {
    hit(key) {
      const cutoff = Date.now() - windowMs;
      const list = (hits.get(key) || []).filter((t) => t > cutoff);
      list.push(Date.now());
      hits.set(key, list);
      return list.length <= max;
    },
    count(key) {
      const cutoff = Date.now() - windowMs;
      return (hits.get(key) || []).filter((t) => t > cutoff).length;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

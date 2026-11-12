// HTTP helpers for the answers the custom server writes itself:
//
//   compressJson()   brotli / gzip for larger JSON answers (by Accept-Encoding)
//   apiCache         very short-lived memory cache for read-only answers that are
//                    the same for everybody, with ETag and "304 Not Modified"
//
// Rule for the cache: only answers that do not depend on who is asking may go
// in. Everything personal (/api/me, lists with "liked by me" …) is computed for
// every request as before.

import crypto from 'node:crypto';
import zlib from 'node:zlib';

// below this size compression saves nothing worth the CPU time
const MIN_COMPRESS_BYTES = 1024;

/** 'br' | 'gzip' | null – what the client accepts (a "q=0" switches an encoding off) */
export function pickEncoding(header) {
  const accepted = new Set();
  for (const part of String(header || '').toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((x) => x.trim());
    const q = params.find((p) => p.startsWith('q='));
    if (name && (!q || Number(q.slice(2)) > 0)) accepted.add(name);
  }
  if (accepted.has('br')) return 'br';
  if (accepted.has('gzip')) return 'gzip';
  return null;
}

/** fast settings: these answers are made per request, not once at build time */
export function compress(buf, encoding) {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buf, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
    });
  }
  return zlib.gzipSync(buf, { level: 6 });
}

const headerName = (headers, name) => Object.keys(headers).find((k) => k.toLowerCase() === name);

function addVary(headers, value) {
  const key = headerName(headers, 'vary');
  if (!key) headers.Vary = value;
  else if (!String(headers[key]).toLowerCase().includes(value.toLowerCase())) headers[key] = `${headers[key]}, ${value}`;
}

/**
 * Call once per request before the answer is written. JSON bodies that are sent
 * with one writeHead() + end() pair (how the whole API answers) get compressed
 * when they are large enough; everything else passes through untouched.
 */
export function compressJson(req, res, { minBytes = MIN_COMPRESS_BYTES } = {}) {
  const encoding = pickEncoding(req.headers['accept-encoding']);
  if (!encoding || req.method === 'HEAD') return;
  const { writeHead, write, end } = res;
  let head = null; // status + headers, held back until we know the body
  const restore = () => {
    res.writeHead = writeHead;
    res.write = write;
    res.end = end;
  };
  const sendHead = () => {
    if (!head) return;
    const { status, headers } = head;
    head = null;
    writeHead.call(res, status, headers);
  };

  res.writeHead = (status, a, b) => {
    const headers = (typeof a === 'string' ? b : a) || {};
    // header lists in array form are rare and not worth handling: let them pass
    if (Array.isArray(headers)) {
      restore();
      return res.writeHead(status, a, b);
    }
    head = { status, headers: { ...headers } };
    return res;
  };
  // a streamed answer: not ours
  res.write = (...args) => {
    restore();
    sendHead();
    return res.write(...args);
  };
  res.end = (chunk, ...rest) => {
    restore();
    if (head && (typeof chunk === 'string' || Buffer.isBuffer(chunk))) {
      const { status, headers } = head;
      const type = String(headers[headerName(headers, 'content-type')] || '');
      const body = typeof chunk === 'string' ? Buffer.from(chunk, typeof rest[0] === 'string' ? rest[0] : 'utf8') : chunk;
      const plain = !headerName(headers, 'content-encoding') && !headerName(headers, 'content-range');
      if (plain && status !== 204 && status !== 304 && type.startsWith('application/json') && body.length >= minBytes) {
        const packed = compress(body, encoding);
        if (packed.length < body.length) {
          const lengthKey = headerName(headers, 'content-length');
          if (lengthKey) delete headers[lengthKey];
          headers['Content-Encoding'] = encoding;
          headers['Content-Length'] = packed.length;
          addVary(headers, 'Accept-Encoding');
          head = null;
          writeHead.call(res, status, headers);
          return end.call(res, packed, ...rest.filter((x) => typeof x === 'function'));
        }
      }
    }
    sendHead();
    return res.end(chunk, ...rest);
  };
}

/** If-None-Match: does one of the listed tags match ours? (weak comparison) */
export function tagMatches(header, etag) {
  const value = String(header || '').trim();
  if (!value) return false;
  if (value === '*') return true;
  const bare = etag.replace(/^W\//, '');
  return value.split(',').some((t) => t.trim().replace(/^W\//, '') === bare);
}

/**
 * Memory cache for finished JSON answers.
 *   cache.send(req, res, key, ttlMs, produce)   answer from the cache or produce() once
 *   cache.value(key, ttlMs, produce)            the same for a plain value (part of an answer)
 *   cache.invalidate(prefix?)                   after a write that changes the answers
 */
export function createMicroCache({ max = 400 } = {}) {
  const entries = new Map(); // key -> { expires, value?, body?, etag?, br?, gzip? }
  const counts = { hits: 0, misses: 0, notModified: 0, invalidations: 0 };

  function entryFor(key, ttlMs, build) {
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.expires > now) {
      counts.hits += 1;
      return hit;
    }
    counts.misses += 1;
    const entry = { expires: now + ttlMs, ...build() };
    entries.delete(key);
    entries.set(key, entry);
    // the oldest entries go first; keys are built from request parameters, so the size must be bounded
    while (entries.size > max) entries.delete(entries.keys().next().value);
    return entry;
  }

  return {
    get size() {
      return entries.size;
    },
    value(key, ttlMs, produce) {
      return entryFor(key, ttlMs, () => ({ value: produce() })).value;
    },
    /**
     * cacheControl: 'no-cache' lets the browser keep the answer but ask every time
     * whether it is still current – unchanged answers then cost a few bytes (304).
     */
    send(req, res, key, ttlMs, produce, { cacheControl = 'no-cache' } = {}) {
      const entry = entryFor(key, ttlMs, () => {
        const body = Buffer.from(JSON.stringify(produce()));
        // weak tag: the same content, whatever the transfer encoding
        return { body, etag: `W/"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 22)}"` };
      });
      const headers = { 'Cache-Control': cacheControl, ETag: entry.etag, Vary: 'Accept-Encoding' };
      if (tagMatches(req.headers['if-none-match'], entry.etag)) {
        counts.notModified += 1;
        res.writeHead(304, headers);
        return res.end();
      }
      let out = entry.body;
      const encoding = out.length >= MIN_COMPRESS_BYTES ? pickEncoding(req.headers['accept-encoding']) : null;
      if (encoding) {
        // compressed once per entry, not once per request
        entry[encoding] ||= compress(entry.body, encoding);
        if (entry[encoding].length < out.length) {
          out = entry[encoding];
          headers['Content-Encoding'] = encoding;
        }
      }
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = out.length;
      res.writeHead(200, headers);
      return res.end(req.method === 'HEAD' ? undefined : out);
    },
    /** forget everything, or only the keys that start with `prefix` */
    invalidate(prefix = '') {
      counts.invalidations += 1;
      if (!prefix) return entries.clear();
      for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
      return undefined;
    },
    stats: () => ({ size: entries.size, max, ...counts }),
  };
}

/** the cache of the public API answers (leaderboards, gallery lists, showcase …) */
export const apiCache = createMicroCache({ max: 400 });

/**
 * A request that changed something was answered: answers in the cache may be
 * out of date. Writes are rare compared to reads, so simply everything goes –
 * except for room creation, which changes none of the cached lists.
 */
export function invalidateAfterWrite(pathname) {
  if (pathname === '/api/rooms' || pathname.startsWith('/api/rooms/')) return;
  apiCache.invalidate();
}

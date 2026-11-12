'use client';

import { authHeaders } from './activity.js';

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// GET requests that are on the wire right now: identical ones share one request
const inflight = new Map();
const writeListeners = new Set();

/** Called after every write (POST, PATCH, DELETE …) – lib/fetchCache.js drops its stale answers there. */
export function onApiWrite(fn) {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

function afterWrite(path, method) {
  // a GET that started before the write may carry the old state: never hand it to new callers
  inflight.clear();
  for (const fn of writeListeners) {
    try {
      fn(path, method);
    } catch (err) {
      console.error(err);
    }
  }
}

async function request(path, method, body, headers) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'network', res.status);
  return data;
}

/**
 * fetch wrapper for our JSON API – throws ApiError(code) on failure.
 * Identical GETs that are in flight share one request; writes always go out
 * on their own and are never cached.
 */
export function api(path, { method = 'GET', body } = {}) {
  const verb = String(method).toUpperCase();
  // inside the Discord Activity the session travels as a bearer token
  const headers = authHeaders();
  if (verb !== 'GET' || body !== undefined) {
    inflight.clear();
    return request(path, verb, body, headers).finally(() => afterWrite(path, verb));
  }
  // the session is part of the key: two identities never share an answer
  const key = `${headers.Authorization || ''} ${path}`;
  const running = inflight.get(key);
  if (running) return running;
  const started = request(path, verb, undefined, headers).finally(() => {
    if (inflight.get(key) === started) inflight.delete(key);
  });
  inflight.set(key, started);
  return started;
}

export function timeAgo(ts, lang) {
  const rtf = new Intl.RelativeTimeFormat(lang === 'de' ? 'de' : 'en', { numeric: 'auto' });
  const diff = (ts - Date.now()) / 1000;
  const steps = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2629800, 'week'],
    [31557600, 'month'],
  ];
  let unit = 'year';
  let div = 31557600;
  let prev = 1;
  for (const [limit, u] of steps) {
    if (Math.abs(diff) < limit) {
      unit = u;
      div = prev;
      break;
    }
    prev = limit;
  }
  return rtf.format(Math.round(diff / div), unit);
}

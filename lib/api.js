'use client';

import { authHeaders } from './activity';

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** fetch wrapper for our JSON API – throws ApiError(code) on failure. */
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'network', res.status);
  return data;
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

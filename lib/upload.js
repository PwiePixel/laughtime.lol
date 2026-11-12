'use client';

import { authHeaders } from './activity';
import { ApiError } from './api';
import { UPLOAD_TYPES } from './shared';

/** sends one picture/GIF as raw body (with progress). Throws ApiError(code). */
export function uploadFile(url, file, headers = {}, onProgress) {
  return new Promise((resolve, reject) => {
    if (!UPLOAD_TYPES.includes(file.type)) {
      reject(new ApiError('file_type', 415));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || ''));
    for (const [k, v] of Object.entries({ ...authHeaders(), ...headers })) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || 'network', xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('network', 0));
    xhr.send(file);
  });
}

/** first picture from a paste/drop event */
export function fileFromEvent(e) {
  const items = e.dataTransfer?.files || e.clipboardData?.files;
  if (!items?.length) return null;
  return [...items].find((f) => UPLOAD_TYPES.includes(f.type)) || items[0];
}

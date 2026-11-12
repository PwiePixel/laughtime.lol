// Small helpers for CPU heavy or file based work inside the server process.

import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Runs at most `concurrency` jobs at the same time. Jobs beyond `maxQueue`
 * waiting ones are rejected with code 'queue_full' – the caller then answers
 * with something cheaper instead of piling up work (and memory).
 */
export function createWorkQueue({ concurrency = 2, maxQueue = 100 } = {}) {
  let active = 0;
  let done = 0;
  let rejected = 0;
  const waiting = [];

  const next = () => {
    while (active < concurrency && waiting.length) {
      const job = waiting.shift();
      active += 1;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          done += 1;
          next();
        });
    }
  };

  return {
    get active() {
      return active;
    },
    get waiting() {
      return waiting.length;
    },
    stats: () => ({ active, waiting: waiting.length, done, rejected }),
    run(fn) {
      return new Promise((resolve, reject) => {
        if (waiting.length >= maxQueue) {
          rejected += 1;
          reject(Object.assign(new Error('work queue is full'), { code: 'queue_full' }));
          return;
        }
        waiting.push({ fn, resolve, reject });
        next();
      });
    },
  };
}

/** JSON file or null when it is missing or broken (a damaged cache file must never stop the server) */
export async function readJsonFile(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Write through a temporary file, so a crash never leaves half a file behind. */
export async function writeJsonFile(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try {
    await fsp.writeFile(tmp, JSON.stringify(data));
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// sharp (image processing) comes with Next.js. It is loaded when it is first
// needed, and if it cannot be loaded on a host the server keeps running:
// pictures are then served as they are.

let sharpModule = null;
let sharpBroken = false;

/** the sharp function or null when it is not available */
export async function getSharp() {
  if (sharpBroken) return null;
  if (!sharpModule) {
    try {
      const sharp = (await import('sharp')).default;
      // our own work queue decides how much runs in parallel; keep the memory of libvips small
      sharp.concurrency(1);
      sharp.cache({ memory: 32, files: 0, items: 64 });
      sharpModule = sharp;
    } catch (err) {
      sharpBroken = true;
      console.warn('\x1b[33m[images]\x1b[0m sharp is not available, pictures are served unchanged:', err.message);
      return null;
    }
  }
  return sharpModule;
}

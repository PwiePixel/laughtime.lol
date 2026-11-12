// Stand-in for the real entry point: the installer tests only need the
// --build-only contract (prepare .next, write the build id, exit 0).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
if (!process.argv.includes('--build-only')) {
  console.error('the test project cannot be started');
  process.exit(1);
}
const buildId = path.join(root, '.next', 'BUILD_ID');
if (!fs.existsSync(buildId)) {
  fs.mkdirSync(path.dirname(buildId), { recursive: true });
  fs.writeFileSync(buildId, 'test-build');
}
fs.appendFileSync(path.join(root, 'build-calls.log'), `NODE_ENV=${process.env.NODE_ENV} NEXT_PUBLIC_LEAK=${process.env.NEXT_PUBLIC_LEAK ?? ''}\n`);

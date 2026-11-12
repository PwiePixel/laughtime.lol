/**
 * LaughTime.lol – Startdatei / entry point
 *
 * Pterodactyl (Node.js egg) runs `node index.js`. This file does everything:
 *   1. checks the Node.js version (and the built-in SQLite database engine)
 *   2. loads .env (and creates it from .env.example on first start)
 *   3. installs npm packages if they are missing
 *   4. builds the Next.js app when there is no build yet or the source changed
 *   5. starts the web server (Next.js + WebSocket game server + media proxy)
 *
 *   node index.js           -> production
 *   node index.js --dev     -> development with hot reload
 *   node index.js --rebuild -> force a fresh build
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const DEV = args.has('--dev') || process.env.LT_DEV === '1';
const FORCE_BUILD = args.has('--rebuild') || process.env.FORCE_BUILD === '1';

const log = (...m) => console.log('\x1b[35m[laughtime]\x1b[0m', ...m);
const fail = (msg) => {
  console.error('\x1b[31m[laughtime]\x1b[0m ' + msg);
  process.exit(1);
};

// 1) Node version -----------------------------------------------------------
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  fail(`Node.js ${process.versions.node} is too old. LaughTime needs Node 22.13 or newer (Node 22 or 24). ` +
    'In Pterodactyl: Startup -> Docker Image -> choose Node 22 or Node 24.');
}

// 1b) built-in SQLite (accounts, leaderboards, meme gallery) ------------------
{
  const origEmit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (String(w?.message || w).includes('SQLite') ? undefined : origEmit.call(process, w, ...rest));
  let hasSqlite = true;
  try {
    await import('node:sqlite');
  } catch {
    hasSqlite = false;
  }
  process.emitWarning = origEmit;
  if (!hasSqlite) {
    const flagged = process.execArgv.includes('--experimental-sqlite');
    if (major === 22 && !flagged) {
      // Node 22.5 – 22.12 only have SQLite behind a flag: restart ourselves with it
      const { spawn } = await import('node:child_process');
      const child = spawn(process.execPath, ['--experimental-sqlite', ...process.execArgv, ...process.argv.slice(1)], {
        stdio: 'inherit',
        env: process.env,
      });
      for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
      child.on('exit', (code) => process.exit(code ?? 0));
      await new Promise(() => {});
    }
    fail(
      `Node.js ${process.versions.node} has no built-in SQLite, which LaughTime needs for accounts. ` +
        'Please use Node.js 22.13+ or 24 (Pterodactyl: Startup -> Docker Image -> Node 22 or Node 24).',
    );
  }
}

// 2) .env -------------------------------------------------------------------
const envFile = path.join(ROOT, '.env');
const envExample = path.join(ROOT, '.env.example');
if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, envFile);
  log('Created .env from .env.example – add your GIPHY / KLIPY keys there (optional).');
}
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    // Pterodactyl variables (real env) win over the file
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = val;
  }
}
process.env.NEXT_TELEMETRY_DISABLED = '1';

// 3) data folders -----------------------------------------------------------
for (const dir of ['data', 'data/cache']) fs.mkdirSync(path.join(ROOT, dir), { recursive: true });

// helpers -------------------------------------------------------------------
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(cmd, cmdArgs, extraEnv = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32',
  });
  if (res.error) fail(`${cmd} failed: ${res.error.message}`);
  if (res.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} exited with code ${res.status}`);
}

function hashSources() {
  const h = crypto.createHash('sha1');
  const include = ['app', 'components', 'lib', 'public', 'next.config.mjs', 'jsconfig.json', 'package.json'];
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) walk(path.join(p, name));
    } else {
      h.update(path.relative(ROOT, p));
      h.update(String(st.size));
      h.update(String(Math.floor(st.mtimeMs)));
    }
  };
  include.forEach((p) => walk(path.join(ROOT, p)));
  // public env vars are baked into the client bundle
  h.update(Object.keys(process.env).filter((k) => k.startsWith('NEXT_PUBLIC_')).sort().map((k) => `${k}=${process.env[k]}`).join('\n'));
  return h.digest('hex');
}

// 4) dependencies -----------------------------------------------------------
// check every package from package.json, so a new one is never missed
const declared = (() => {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies || {});
  } catch {
    return [];
  }
})();
const needInstall = declared.some((pkg) => !fs.existsSync(path.join(ROOT, 'node_modules', pkg, 'package.json')));
if (needInstall) {
  log('Installing npm packages (first start can take a minute)…');
  run(npmCmd, ['install', '--no-audit', '--no-fund', '--loglevel=error']);
}

// 5) build ------------------------------------------------------------------
const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const buildIdFile = path.join(ROOT, '.next', 'BUILD_ID');
const hashFile = path.join(ROOT, '.next', 'laughtime-build-hash');
if (!DEV) {
  const current = hashSources();
  const previous = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, 'utf8').trim() : '';
  if (FORCE_BUILD || !fs.existsSync(buildIdFile) || previous !== current) {
    log(fs.existsSync(buildIdFile) ? 'Source changed – rebuilding…' : 'No build found – building the app…');
    run(process.execPath, [nextBin, 'build'], { NODE_ENV: 'production' });
    fs.writeFileSync(hashFile, current);
  } else {
    log('Build is up to date.');
  }
}

// 6) start ------------------------------------------------------------------
process.env.NODE_ENV = DEV ? 'development' : 'production';
const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server', 'server.js')).href);
await startServer({ dev: DEV, dir: ROOT });

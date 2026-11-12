// Runs install.sh in a throw-away project with test doubles for every program
// that would change the system (cloudflared, systemctl, pm2, npm, curl, sudo).
// LT_INSTALL_ROOT keeps all "system" files below the temporary folder.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const INSTALLER = path.join(REPO, 'install.sh');
export const TUNNEL_ID = '11111111-2222-3333-4444-555555555555';

export const has = (cmd) => spawnSync('bash', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;

/** why the flow tests cannot run here, or '' */
export function skipReason() {
  if (process.platform !== 'linux') return 'the installer targets Linux';
  if (spawnSync('bash', ['--version'], { stdio: 'ignore' }).status !== 0) return 'bash is not installed';
  for (const cmd of ['git', 'tar', 'gzip', 'sha256sum']) if (!has(cmd)) return `${cmd} is not installed`;
  return '';
}

export const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const mode = (file) => (fs.statSync(file).mode & 0o777).toString(8);

/** a fresh project folder with the installer, its templates and the test doubles */
export function sandbox(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'laughtime-install-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const dirs = {
    base,
    project: path.join(base, 'project'),
    root: path.join(base, 'root'),
    home: path.join(base, 'home'),
    state: path.join(base, 'state'),
    // a copy, so another account can run the test doubles too
    bin: path.join(base, 'bin'),
    log: path.join(base, 'calls.log'),
  };
  for (const dir of [dirs.root, dirs.home, dirs.state]) fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(HERE, 'project'), dirs.project, { recursive: true });
  fs.cpSync(path.join(HERE, 'bin'), dirs.bin, { recursive: true });
  fs.cpSync(INSTALLER, path.join(dirs.project, 'install.sh'));
  fs.cpSync(path.join(REPO, 'deploy'), path.join(dirs.project, 'deploy'), { recursive: true });
  fs.writeFileSync(dirs.log, '');

  const user = os.userInfo().username;
  const run = (args = [], env = {}) => {
    const res = spawnSync('bash', [path.join(dirs.project, 'install.sh'), ...args], {
      cwd: base,
      encoding: 'utf8',
      timeout: 120_000,
      // no terminal: the installer must not wait for an answer
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: `${dirs.bin}:${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
        HOME: dirs.home,
        LANG: 'C.UTF-8',
        TERM: 'dumb',
        TMPDIR: base,
        LT_INSTALL_ROOT: dirs.root,
        LT_INSTALL_INIT: 'systemd',
        LT_INSTALL_HEALTH_TIMEOUT: '4',
        LT_INSTALL_PUBLIC_TIMEOUT: '2',
        LT_INSTALL_LOGIN_TIMEOUT: '30',
        STUB_LOG: dirs.log,
        STUB_STATE: dirs.state,
        STUB_LOGIN_DELAY: '0',
        ...env,
      },
    });
    return { code: res.status, out: `${res.stdout}${res.stderr}`, signal: res.signal };
  };
  const calls = () => fs.readFileSync(dirs.log, 'utf8').split('\n').filter(Boolean);
  const clearCalls = () => fs.writeFileSync(dirs.log, '');
  const rootFile = (p) => path.join(dirs.root, p);
  return { ...dirs, user, run, calls, clearCalls, rootFile };
}

/** index of the first recorded call that contains the text; fails with the whole list when missing */
export function callIndex(calls, text) {
  const index = calls.findIndex((line) => line.includes(text));
  if (index < 0) throw new Error(`call not found: "${text}"\n${calls.join('\n')}`);
  return index;
}

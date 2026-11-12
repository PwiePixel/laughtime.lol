// Static checks of install.sh: syntax, shellcheck, --help, argument errors, --dry-run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { INSTALLER, REPO, has, sandbox, skipReason } from './install-fixtures/harness.js';

const noBash = spawnSync('bash', ['--version'], { stdio: 'ignore' }).status !== 0 ? 'bash is not installed' : false;
const bash = (args, opts = {}) => spawnSync('bash', args, { encoding: 'utf8', timeout: 60_000, ...opts });

test('install.sh is executable and parses', { skip: noBash }, () => {
  assert.ok(fs.statSync(INSTALLER).mode & 0o100, 'install.sh must be executable');
  const res = bash(['-n', INSTALLER]);
  assert.equal(res.status, 0, res.stderr);
});

test('shellcheck has nothing to report', { skip: noBash || (!has('shellcheck') && 'shellcheck is not installed') }, () => {
  const files = [INSTALLER, ...fs.readdirSync(path.join(REPO, 'test', 'install-fixtures', 'bin')).map((f) => path.join(REPO, 'test', 'install-fixtures', 'bin', f))];
  // shellcheck needs a UTF-8 locale to print findings next to non-ASCII text
  const res = spawnSync('shellcheck', ['--severity=style', ...files], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
});

test('--help lists every option and changes nothing', { skip: noBash }, () => {
  const res = bash([INSTALLER, '--help']);
  assert.equal(res.status, 0, res.stderr);
  for (const flag of ['--yes', '--domain', '--beta-domain', '--no-beta', '--no-www', '--port', '--tunnel-name', '--no-tunnel',
    '--no-service', '--pm2', '--user', '--update', '--uninstall', '--dry-run', '--help']) {
    assert.ok(res.stdout.includes(flag), `--help does not mention ${flag}`);
  }
});

test('wrong arguments are rejected before anything happens', { skip: noBash }, () => {
  for (const args of [['--bogus'], ['--port', 'abc'], ['--port', '70000'], ['--domain'], ['--domain', 'not a domain'],
    ['--tunnel-name', 'bad name'], ['--user', 'Bad User']]) {
    const res = bash([INSTALLER, ...args]);
    assert.equal(res.status, 2, `${args.join(' ')} -> ${res.status}\n${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /install\.sh: /);
  }
});

test('the unit templates have no unknown placeholders', () => {
  const known = { 'laughtime.service': ['USER', 'GROUP', 'APP_DIR', 'NODE', 'PATH', 'PORT_ENV', 'CAPS'], 'cloudflared-laughtime.service': ['TUNNEL_NAME', 'CLOUDFLARED', 'CONFIG'] };
  for (const [file, names] of Object.entries(known)) {
    const text = fs.readFileSync(path.join(REPO, 'deploy', file), 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n');
    const used = new Set([...text.matchAll(/@([A-Z_]+)@/g)].map((m) => m[1]));
    assert.deepEqual([...used].sort(), [...names].sort(), file);
    assert.match(text, /^Restart=always$/m);
    assert.match(text, /^KillSignal=SIGTERM$/m);
  }
});

test('--dry-run prints the plan and changes nothing', { skip: skipReason() || false }, (t) => {
  const box = sandbox(t);
  const before = fs.readdirSync(box.project).sort();
  const res = box.run(['--dry-run', '--yes', '--user', box.user, '--domain', 'example.test']);
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /\[dry-run\] .*cloudflared tunnel login/);
  assert.match(res.out, /\[dry-run\] cloudflared tunnel route dns --overwrite-dns laughtime beta\.example\.test/);
  assert.match(res.out, /\[dry-run\] .*systemctl enable --now laughtime\.service/);
  assert.match(res.out, /- service: http_status:404/);
  assert.deepEqual(fs.readdirSync(box.project).sort(), before, 'the project folder changed');
  assert.deepEqual(fs.readdirSync(box.root), [], 'system files were written');
  assert.deepEqual(fs.readdirSync(box.home), [], 'the home folder changed');
  // nothing but read-only questions may reach the other programs
  const writes = box.calls().filter((c) => !/^(cloudflared --version|pm2 --version|npm prefix -g|systemctl is-active)/.test(c));
  assert.deepEqual(writes, []);
});

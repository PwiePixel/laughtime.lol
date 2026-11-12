// End-to-end runs of install.sh against test doubles: .env protection, the
// systemd and PM2 branches, the Cloudflare Tunnel flow, uninstall.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { TUNNEL_ID, callIndex, mode, sandbox, sha256, skipReason } from './install-fixtures/harness.js';

const skip = skipReason() || false;
const FULL = (box) => ['--yes', '--user', box.user, '--domain', 'example.test', '--port', '4321'];
const WEBHOOK = 'https://discord.test/api/webhooks/1234/very-secret-token';

test('a fresh .env is a private copy of .env.example', { skip }, (t) => {
  const box = sandbox(t);
  const res = box.run(['--yes', '--user', box.user, '--no-service', '--no-tunnel']);
  assert.equal(res.code, 0, res.out);
  const env = path.join(box.project, '.env');
  assert.equal(fs.readFileSync(env, 'utf8'), fs.readFileSync(path.join(box.project, '.env.example'), 'utf8'));
  assert.equal(mode(env), '600');
  assert.ok(fs.statSync(path.join(box.project, 'data')).isDirectory());
  assert.match(fs.readFileSync(path.join(box.project, 'data', 'install.log'), 'utf8'), /Project files and settings/);
  assert.match(res.out, /PUBLIC_URL/);
  // the build ran the way the service will run it
  assert.match(fs.readFileSync(path.join(box.project, 'build-calls.log'), 'utf8'), /^NODE_ENV=production NEXT_PUBLIC_LEAK=\n$/);
});

test('an existing .env is never changed, executed or printed', { skip }, (t) => {
  const box = sandbox(t);
  const env = path.join(box.project, '.env');
  const trap = path.join(box.base, 'executed');
  fs.writeFileSync(env, [
    '# my settings – marker 4711',
    'PORT = 5555',
    'PUBLIC_URL="https://Mine.Example.test/path"',
    `EVIL=$(touch ${trap})`,
    `EVIL2=\`touch ${trap}\``,
    'SESSION_SECRET=do-not-print-me',
    'TRUST_PROXY=false',
    '',
  ].join('\n'), { mode: 0o640 });
  const before = { hash: sha256(env), mode: mode(env), mtime: fs.statSync(env).mtimeMs };

  const res = box.run(['--yes', '--user', box.user, '--no-announce'], { NEXT_PUBLIC_LEAK: 'from-the-shell' });
  assert.equal(res.code, 0, res.out);
  assert.deepEqual({ hash: sha256(env), mode: mode(env), mtime: fs.statSync(env).mtimeMs }, before);
  assert.equal(fs.existsSync(trap), false, 'a value from .env was executed');
  assert.deepEqual(fs.readdirSync(box.project).filter((f) => f.startsWith('.env')).sort(), ['.env', '.env.example']);
  const log = fs.readFileSync(path.join(box.project, 'data', 'install.log'), 'utf8');
  for (const text of [res.out, log]) assert.equal(text.includes('do-not-print-me'), false);

  // the settings were read: domain and port come from the file
  const config = fs.readFileSync(box.rootFile('etc/cloudflared/laughtime.yml'), 'utf8');
  assert.match(config, /hostname: mine\.example\.test\n {4}service: http:\/\/localhost:5555/);
  assert.match(res.out, /TRUST_PROXY is switched off/);
  // variables of the calling shell do not leak into the build
  assert.match(fs.readFileSync(path.join(box.project, 'build-calls.log'), 'utf8'), /NEXT_PUBLIC_LEAK=\n/);
});

test('systemd and tunnel: units, configuration and the order of the calls', { skip }, (t) => {
  const box = sandbox(t);
  // a tunnel of somebody else on the same server
  const foreign = box.rootFile('etc/cloudflared/config.yml');
  fs.mkdirSync(path.dirname(foreign), { recursive: true });
  fs.writeFileSync(foreign, 'tunnel: other\n');

  const res = box.run(FULL(box));
  assert.equal(res.code, 0, res.out);
  const calls = box.calls();
  assert.equal(calls.some((c) => c.startsWith('sudo')), false, 'sudo was called');

  // app unit
  const unit = fs.readFileSync(box.rootFile('etc/systemd/system/laughtime.service'), 'utf8');
  assert.equal(/@[A-Z_]+@/.test(unit.split('\n').filter((l) => !l.startsWith('#')).join('\n')), false, 'placeholder left in the unit');
  assert.match(unit, new RegExp(`^User=${box.user}$`, 'm'));
  assert.ok(unit.includes(`WorkingDirectory=${box.project}\n`));
  assert.ok(unit.includes(`ExecStart="${process.execPath}" "${box.project}/index.js"\n`), unit);
  assert.match(unit, /^Environment=SERVER_PORT=4321$/m);
  assert.match(unit, /^Environment=NODE_ENV=production$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^CapabilityBoundingSet=$/m);
  assert.ok(unit.includes(`ReadWritePaths=${box.project}\n`));

  // tunnel unit and configuration
  const tunnelUnit = fs.readFileSync(box.rootFile('etc/systemd/system/cloudflared-laughtime.service'), 'utf8');
  assert.match(tunnelUnit, /^ExecStart=".*\/cloudflared" --no-autoupdate tunnel --config "\/etc\/cloudflared\/laughtime\.yml" run$/m);
  const config = fs.readFileSync(box.rootFile('etc/cloudflared/laughtime.yml'), 'utf8');
  const rules = config.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  assert.deepEqual(rules, [
    `tunnel: ${TUNNEL_ID}`,
    `credentials-file: /etc/cloudflared/${TUNNEL_ID}.json`,
    'ingress:',
    '  - hostname: example.test',
    '    service: http://localhost:4321',
    '  - hostname: www.example.test',
    '    service: http://localhost:4321',
    '  - hostname: beta.example.test',
    '    service: http://localhost:4321',
    '  - service: http_status:404',
  ]);
  assert.equal(mode(box.rootFile(`etc/cloudflared/${TUNNEL_ID}.json`)), '600');
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'tunnel: other\n', 'the configuration of another tunnel was touched');

  // order: app service first, then login -> tunnel -> config -> DNS -> tunnel service -> public check
  const order = [
    'npm install',
    'systemctl daemon-reload',
    'systemctl enable --now laughtime.service',
    'curl http://127.0.0.1:4321/api/status',
    'cloudflared tunnel login',
    'cloudflared tunnel list --output json --name laughtime',
    'cloudflared tunnel create laughtime',
    'ingress validate',
    `cloudflared tunnel route dns --overwrite-dns ${TUNNEL_ID} example.test`,
    `cloudflared tunnel route dns --overwrite-dns ${TUNNEL_ID} www.example.test`,
    `cloudflared tunnel route dns --overwrite-dns ${TUNNEL_ID} beta.example.test`,
    'systemctl enable --now cloudflared-laughtime.service',
    'curl https://example.test/api/status',
  ].map((text) => callIndex(calls, text));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), calls.join('\n'));

  // the authorisation link cannot be missed
  assert.match(res.out, /OPEN THIS LINK IN YOUR BROWSER[\s\S]*https:\/\/dash\.cloudflare\.com\/argotunnel\?aud=[\s\S]*Choose the zone {2}example\.test/);
  assert.match(res.out, /https:\/\/example\.test answers/);
  assert.match(res.out, /LaughTime is installed/);

  // second run: nothing is done twice, nobody is thrown out of a game
  const envHash = sha256(path.join(box.project, '.env'));
  box.clearCalls();
  const again = box.run(FULL(box));
  assert.equal(again.code, 0, again.out);
  const second = box.calls();
  for (const text of ['tunnel login', 'tunnel create', 'systemctl restart', 'daemon-reload', 'npm ']) {
    assert.equal(second.some((c) => c.includes(text)), false, `second run called "${text}"\n${second.join('\n')}`);
  }
  assert.equal(sha256(path.join(box.project, '.env')), envHash);
  assert.deepEqual(fs.readdirSync(box.rootFile('etc/cloudflared')).sort(), [`${TUNNEL_ID}.json`, 'config.yml', 'laughtime.yml']);

  // changed hostnames: our previous configuration is kept as a backup, the tunnel restarts, the app does not
  box.clearCalls();
  const changed = box.run([...FULL(box), '--no-www', '--beta-domain', 'next.example.test']);
  assert.equal(changed.code, 0, changed.out);
  const backups = fs.readdirSync(box.rootFile('etc/cloudflared')).filter((f) => /^laughtime\.yml\.bak-\d{8}-\d{6}$/.test(f));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(box.rootFile(`etc/cloudflared/${backups[0]}`), 'utf8'), config);
  const updated = fs.readFileSync(box.rootFile('etc/cloudflared/laughtime.yml'), 'utf8');
  assert.equal(updated.includes('www.example.test'), false);
  assert.match(updated, /hostname: next\.example\.test/);
  const third = box.calls();
  callIndex(third, 'systemctl restart cloudflared-laughtime.service');
  assert.equal(third.some((c) => c.includes('restart laughtime.service')), false);

  // uninstall: services and our tunnel files go, settings and data stay
  box.clearCalls();
  const gone = box.run(['--uninstall', '--yes']);
  assert.equal(gone.code, 0, gone.out);
  callIndex(box.calls(), 'systemctl disable --now laughtime.service');
  callIndex(box.calls(), 'systemctl disable --now cloudflared-laughtime.service');
  assert.deepEqual(fs.readdirSync(box.rootFile('etc/systemd/system')), []);
  assert.deepEqual(fs.readdirSync(box.rootFile('etc/cloudflared')), ['config.yml']);
  assert.equal(sha256(path.join(box.project, '.env')), envHash);
  assert.ok(fs.existsSync(path.join(box.project, 'data', 'install.log')));
  assert.ok(fs.existsSync(path.join(box.home, '.cloudflared', 'cert.pem')));
  assert.ok(fs.existsSync(path.join(box.home, '.cloudflared', `${TUNNEL_ID}.json`)));
});

test('an existing tunnel is reused and its credentials are fetched', { skip }, (t) => {
  const box = sandbox(t);
  fs.mkdirSync(path.join(box.home, '.cloudflared'), { recursive: true });
  fs.writeFileSync(path.join(box.home, '.cloudflared', 'cert.pem'), 'cert');
  fs.writeFileSync(path.join(box.state, 'tunnel-party'), '');
  const res = box.run([...FULL(box), '--tunnel-name', 'party', '--no-beta']);
  assert.equal(res.code, 0, res.out);
  const calls = box.calls();
  assert.equal(calls.some((c) => c.includes('tunnel login') || c.includes('tunnel create')), false, calls.join('\n'));
  callIndex(calls, `cloudflared tunnel token --cred-file ${box.home}/.cloudflared/${TUNNEL_ID}.json ${TUNNEL_ID}`);
  callIndex(calls, 'systemctl enable --now cloudflared-party.service');
  const config = fs.readFileSync(box.rootFile('etc/cloudflared/party.yml'), 'utf8');
  assert.equal(config.includes('beta.'), false);
  assert.match(fs.readFileSync(box.rootFile(`etc/cloudflared/${TUNNEL_ID}.json`), 'utf8'), /fetched/);
});

test('DNS problems and a silent public URL are reported, not hidden', { skip }, (t) => {
  const box = sandbox(t);
  fs.writeFileSync(path.join(box.project, '.env'), `PORT=3000\nPUBLIC_URL=https://example.test\nDISCORD_WEBHOOK_URL=${WEBHOOK}\n`);
  const res = box.run(FULL(box), { STUB_DNS_FAIL: 'www.example.test', STUB_DNS_WRONG_ZONE: 'beta.example.test', STUB_PUBLIC_HTTP: '530' });
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /DNS record for www\.example\.test could not be created/);
  assert.match(res.out, /DNS record for beta\.example\.test landed in another zone/);
  assert.match(res.out, /No DNS record for: www\.example\.test beta\.example\.test/);
  assert.match(res.out, /DNS: example\.test -> tunnel laughtime/);
  assert.match(res.out, /https:\/\/example\.test does not answer yet/);
  // nobody is told "we are live" while the address does not answer
  assert.equal(box.calls().some((c) => c.startsWith('curl webhook')), false);
});

test('the login gives up with a helpful message', { skip }, (t) => {
  const box = sandbox(t);
  const res = box.run(FULL(box), { STUB_LOGIN_NEVER: '1', LT_INSTALL_LOGIN_TIMEOUT: '3' });
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /OPEN THIS LINK IN YOUR BROWSER/);
  assert.match(res.out, /No authorisation within/);
  assert.match(res.out, /Stopped in step: Cloudflare Tunnel/);
  assert.match(res.out, /run the same command again/);
  assert.equal(box.calls().some((c) => c.includes('tunnel create')), false);
});

test('an unhealthy app stops the installation with its log lines', { skip }, (t) => {
  const box = sandbox(t);
  const res = box.run(FULL(box), { STUB_LOCAL_HTTP: '000' });
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /did not answer on http:\/\/127\.0\.0\.1:4321\/api\/status/);
  assert.match(res.out, /journal lines of the test double/);
  assert.equal(box.calls().some((c) => c.startsWith('cloudflared tunnel')), false, 'the tunnel was set up for a dead app');
});

test('the Discord webhook gets one message and stays secret', { skip }, (t) => {
  const box = sandbox(t);
  fs.writeFileSync(path.join(box.project, '.env'), `PORT=3000\nPUBLIC_URL=https://example.test\nDISCORD_WEBHOOK_URL=${WEBHOOK}\n`);
  const res = box.run(FULL(box));
  assert.equal(res.code, 0, res.out);
  assert.deepEqual(box.calls().filter((c) => c.startsWith('curl webhook')), [`curl webhook url = "${WEBHOOK}"`]);
  const payload = JSON.parse(fs.readFileSync(path.join(box.state, 'webhook-payload'), 'utf8'));
  assert.match(payload.content, /LaughTime v2 is live on example\.test/);
  assert.match(payload.content, /LaughTime v2 ist jetzt live: https:\/\/example\.test/);
  const log = fs.readFileSync(path.join(box.project, 'data', 'install.log'), 'utf8');
  for (const text of [res.out, log]) assert.equal(text.includes('very-secret-token'), false, 'the webhook address leaked');

  // a second run does not post again
  box.clearCalls();
  assert.equal(box.run(FULL(box)).code, 0);
  assert.equal(box.calls().some((c) => c.startsWith('curl webhook')), false);

  // a webhook that fails never fails the installation
  const other = sandbox(t);
  fs.writeFileSync(path.join(other.project, '.env'), `PORT=3000\nDISCORD_WEBHOOK_URL=${WEBHOOK}\n`);
  const failed = other.run(FULL(other), { STUB_WEBHOOK_EXIT: '22' });
  assert.equal(failed.code, 0, failed.out);
  assert.match(failed.out, /did not accept the message/);
});

test('scripts/announce.mjs is used when it exists', { skip }, (t) => {
  const box = sandbox(t);
  fs.writeFileSync(path.join(box.project, '.env'), `PORT=3000\nDISCORD_WEBHOOK_URL=${WEBHOOK}\n`);
  fs.mkdirSync(path.join(box.project, 'scripts'));
  fs.writeFileSync(path.join(box.project, 'scripts', 'announce.mjs'),
    "import fs from 'node:fs';\nfs.writeFileSync('announce-args.json', JSON.stringify(process.argv.slice(2)));\n");
  const res = box.run(FULL(box));
  assert.equal(res.code, 0, res.out);
  const args = JSON.parse(fs.readFileSync(path.join(box.project, 'announce-args.json'), 'utf8'));
  assert.equal(args.length, 2);
  assert.equal(args[0], 'LaughTime v2 is live on example.test');
  assert.equal(box.calls().some((c) => c.startsWith('curl webhook')), false);
});

test('without systemd the app and the tunnel run with PM2', { skip }, (t) => {
  const box = sandbox(t);
  const res = box.run(FULL(box), { LT_INSTALL_INIT: 'none' });
  assert.equal(res.code, 0, res.out);
  const calls = box.calls();
  const config = `${box.home}/.cloudflared/laughtime.yml`;
  callIndex(calls, `pm2 start ${box.project}/index.js --name laughtime --cwd ${box.project} --interpreter ${process.execPath}`);
  callIndex(calls, 'pm2-env laughtime NODE_ENV=production SERVER_PORT=4321');
  callIndex(calls, `--name cloudflared-laughtime --interpreter none --time --restart-delay 5000 -- --no-autoupdate tunnel --config ${config} run`);
  callIndex(calls, 'pm2 save');
  assert.equal(calls.some((c) => c.startsWith('systemctl')), false);
  assert.equal(fs.existsSync(box.rootFile('etc')), false, 'nothing belongs into /etc without systemd');
  // the tunnel runs as the same user, so it reads the original credentials
  assert.match(fs.readFileSync(config, 'utf8'), new RegExp(`credentials-file: ${box.home}/.cloudflared/${TUNNEL_ID}.json`));
  assert.match(res.out, /pm2 resurrect/);

  // --pm2 is remembered: a later run on this server stays with PM2
  box.clearCalls();
  const again = box.run(FULL(box), { LT_INSTALL_INIT: 'none' });
  assert.equal(again.code, 0, again.out);
  assert.equal(box.calls().some((c) => c.startsWith('pm2 start') || c.startsWith('pm2 delete')), false, box.calls().join('\n'));

  const gone = box.run(['--uninstall', '--yes'], { LT_INSTALL_INIT: 'none' });
  assert.equal(gone.code, 0, gone.out);
  callIndex(box.calls(), 'pm2 delete laughtime');
  callIndex(box.calls(), 'pm2 delete cloudflared-laughtime');
  assert.equal(fs.existsSync(config), false);
  assert.ok(fs.existsSync(path.join(box.home, '.cloudflared', `${TUNNEL_ID}.json`)), 'the original credentials were deleted');
  assert.ok(fs.existsSync(path.join(box.project, '.env')));
});

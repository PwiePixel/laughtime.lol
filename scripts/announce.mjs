#!/usr/bin/env node
/**
 * Posts an announcement to the community's Discord channel (DISCORD_WEBHOOK_URL).
 *
 *   node scripts/announce.mjs "Title" "Text"
 *   node scripts/announce.mjs "LaughTime v2 is live" "New game modes!\nHave fun." --url=https://laughtime.lol/news
 *
 *   --url=…      link behind the headline (default: PUBLIC_URL)
 *   --force      send even if the same announcement went out a few minutes ago
 *   --dry-run    only check the settings, send nothing
 *   --strict     exit with code 1 when the message could not be delivered
 *   --mod-test   send a test message to the moderators' channel (DISCORD_MOD_WEBHOOK_URL) instead
 *
 * Meant to be called by the installer after a successful deployment – the
 * server itself never announces anything on start. Reads .env the same way
 * index.js does (real environment variables win). The webhook URL is a secret
 * and is never printed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the same announcement twice within this time is skipped (an installer that runs twice)
const REPEAT_GUARD_MS = 10 * 60_000;

const say = (...m) => console.log('[announce]', ...m);

// .env -----------------------------------------------------------------------
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = val;
  }
}

// arguments ------------------------------------------------------------------
const flags = new Map();
const words = [];
for (const arg of process.argv.slice(2)) {
  const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(arg);
  if (m) flags.set(m[1], m[2] ?? true);
  else words.push(arg);
}
// "\n" typed in a shell argument means a line break
const unescape = (s) => String(s ?? '').replace(/\\n/g, '\n');
const title = unescape(words[0]).trim();
const text = unescape(words[1]).trim();

const { sendAnnouncement, sendModeratorTest, webhookStatus } = await import(pathToFileURL(path.join(ROOT, 'server', 'webhook.js')).href);

async function main() {
  if (flags.has('mod-test')) {
    if (!webhookStatus().moderators) {
      say('DISCORD_MOD_WEBHOOK_URL is not set (or not a Discord webhook URL) – nothing sent.');
      return 0;
    }
    const result = await sendModeratorTest();
    say(result.ok ? 'Test message sent to the moderators.' : `Test message not delivered (${result.reason}).`);
    return result.ok || !flags.has('strict') ? 0 : 1;
  }

  if (!title || words.length > 2) {
    console.error('Usage: node scripts/announce.mjs "Title" "Text" [--url=https://…] [--force] [--dry-run] [--strict]');
    return 2;
  }
  if (!webhookStatus().announcements) {
    say('DISCORD_WEBHOOK_URL is not set (or not a Discord webhook URL) – nothing sent.');
    return 0;
  }
  if (flags.has('dry-run')) {
    say(`Dry run – would announce "${title}"${text ? ` (${text.length} characters of text)` : ''}.`);
    return 0;
  }

  // an installer that is started twice must not post twice
  const stateFile = path.join(ROOT, 'data', '.announce-last');
  const hash = crypto.createHash('sha256').update(`${title}\n${text}\n${flags.get('url') || ''}`).digest('hex');
  if (!flags.has('force')) {
    try {
      const last = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (last.hash === hash && Date.now() - last.at < REPEAT_GUARD_MS) {
        say('The same announcement was sent a few minutes ago – skipped (use --force to send it again).');
        return 0;
      }
    } catch {
      /* no earlier announcement */
    }
  }

  const result = await sendAnnouncement({ title, text, url: typeof flags.get('url') === 'string' ? flags.get('url') : undefined });
  if (!result.ok) {
    say(`Announcement not delivered (${result.reason}${result.status ? ` ${result.status}` : ''}).`);
    return flags.has('strict') ? 1 : 0;
  }
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ hash, at: Date.now() }));
  } catch {
    /* read-only disk: the guard just does not work */
  }
  say(`Announced "${title}".`);
  return 0;
}

process.exit(await main());

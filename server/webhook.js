// Discord webhooks (both optional and off until a URL is set):
//
//   DISCORD_WEBHOOK_URL      community announcements – sendAnnouncement(), used by
//                            scripts/announce.mjs after a deployment. The server
//                            never posts on its own start: a restart loop would
//                            flood the channel.
//   DISCORD_MOD_WEBHOOK_URL  heads-up for the moderators when a report or a pack
//                            review request arrives – notifyModerators(). Coalesced
//                            to one message per minute that only carries counts,
//                            the reason categories and a link to /admin.
//
// Everything goes through server/discord.js (queue + 429 back-off) and fails
// silently: a problem is logged once, never thrown at the caller.

import { REPORT_REASONS } from '../lib/shared.js';
import { normalizeLang, translate } from '../lib/i18n.js';
import { getConfig } from './config.js';
import { executeWebhook, parseWebhookUrl } from './discord.js';

// brand colours of the logo (yellow "L", pink face)
const COLOR_ANNOUNCE = 0xffd23f;
const COLOR_MOD = 0xff4fa3;
const TITLE_MAX = 256;
const TEXT_MAX = 4000;

const lang = () => normalizeLang(String(process.env.DISCORD_WEBHOOK_LANG || 'en').toLowerCase());
const publicUrl = () => getConfig().publicUrl.replace(/\/+$/, '');

// each problem is reported once until things work again
const warned = new Set();
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[webhook] ${message}`);
}

/**
 * The webhook behind an environment variable: { id, token, threadId },
 * null when it is not set or not a Discord webhook URL.
 */
function webhookFromEnv(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return null;
  const hook = parseWebhookUrl(raw);
  // the URL is a secret: name the variable, never the value
  if (!hook) warnOnce(`url:${name}`, `${name} is not a Discord webhook URL (https://discord.com/api/webhooks/…) – ignored`);
  return hook;
}

export const webhookStatus = () => ({
  announcements: Boolean(webhookFromEnv('DISCORD_WEBHOOK_URL')),
  moderators: Boolean(webhookFromEnv('DISCORD_MOD_WEBHOOK_URL')),
});

const clean = (value, max) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

function httpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function post(name, payload) {
  const hook = webhookFromEnv(name);
  if (!hook) return { ok: false, reason: String(process.env[name] || '').trim() ? 'invalid_url' : 'not_configured' };
  try {
    await executeWebhook(hook, payload);
    warned.delete(`send:${name}`);
    return { ok: true };
  } catch (err) {
    warnOnce(`send:${name}`, `${name}: message not delivered (${err.message})`);
    return { ok: false, reason: 'failed', status: err.status || 0 };
  }
}

/**
 * Posts an announcement to the community channel.
 *   title  headline (required)
 *   text   body, Discord markdown allowed
 *   url    link behind the headline (default: PUBLIC_URL)
 * Resolves to { ok } or { ok: false, reason } – it never throws.
 */
export async function sendAnnouncement({ title, text = '', url } = {}) {
  const headline = clean(title, TITLE_MAX);
  if (!headline) return { ok: false, reason: 'invalid_input' };
  const embed = { title: headline, url: httpUrl(url) || publicUrl(), color: COLOR_ANNOUNCE };
  const description = clean(text, TEXT_MAX);
  if (description) embed.description = description;
  return post('DISCORD_WEBHOOK_URL', { embeds: [embed] });
}

// --- heads-up for the moderators ------------------------------------------------------

const MOD_KINDS = ['report', 'pack_review'];

/** The message for collected events: only numbers and reason categories. */
export function moderatorMessage(counts, { language = lang(), adminUrl = `${publicUrl()}/admin` } = {}) {
  const t = (key, vars) => translate(language, key, vars);
  const lines = [];
  const reports = counts.report;
  if (reports?.total) {
    const reasons = [...reports.reasons]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => `${n}× ${t(`report.reason.${reason}`)}`)
      .join(', ');
    lines.push(`${t(reports.total === 1 ? 'discord.mod.report' : 'discord.mod.reports', { n: reports.total })} (${reasons})`);
  }
  const packs = counts.pack_review;
  if (packs?.total) lines.push(t(packs.total === 1 ? 'discord.mod.pack' : 'discord.mod.packs', { n: packs.total }));
  return {
    embeds: [
      {
        title: t('discord.mod.title'),
        description: `${lines.join('\n')}\n\n[${t('discord.mod.open')}](${adminUrl})`,
        url: adminUrl,
        color: COLOR_MOD,
      },
    ],
  };
}

/**
 * Collects events and hands them to `send` in one piece:
 *   settleMs    wait this long after the first event, so a burst becomes one message
 *   intervalMs  minimum time between two messages
 * A failed delivery is tried again with the next message (at most maxFailures
 * times in a row, then the collected numbers are dropped).
 */
export function createModNotifier({ send, intervalMs = 60_000, settleMs = 5_000, maxFailures = 3 } = {}) {
  let counts = {};
  let timer = null;
  let lastAttempt = 0;
  let failures = 0;
  let sending = false;

  const add = (kind, reason, n = 1) => {
    const entry = (counts[kind] ||= { total: 0, reasons: new Map() });
    entry.total += n;
    if (reason) entry.reasons.set(reason, (entry.reasons.get(reason) || 0) + n);
  };
  const isEmpty = () => !Object.keys(counts).length;

  function schedule() {
    if (timer || sending || isEmpty()) return;
    const wait = Math.max(settleMs, lastAttempt + intervalMs - Date.now());
    timer = setTimeout(fire, wait);
    timer.unref?.();
  }

  async function fire() {
    timer = null;
    if (sending || isEmpty()) return;
    const batch = counts;
    counts = {};
    sending = true;
    lastAttempt = Date.now();
    let ok = false;
    try {
      ok = (await send(batch)) !== false;
    } catch {
      ok = false;
    }
    sending = false;
    if (ok) {
      failures = 0;
    } else if (++failures < maxFailures) {
      // keep the numbers for the next message
      for (const [kind, entry] of Object.entries(batch)) {
        if (entry.reasons.size) for (const [reason, n] of entry.reasons) add(kind, reason, n);
        else add(kind, null, entry.total);
      }
    } else {
      failures = 0;
    }
    schedule();
  }

  return {
    /** kind: 'report' | 'pack_review'; reason: report category (optional) */
    notify(kind, reason = null) {
      if (!MOD_KINDS.includes(kind)) return;
      add(kind, kind === 'report' ? (REPORT_REASONS.includes(reason) ? reason : 'other') : null);
      schedule();
    },
    /** events that are waiting for the next message */
    pending: () => Object.values(counts).reduce((sum, entry) => sum + entry.total, 0),
    stop() {
      clearTimeout(timer);
      timer = null;
      counts = {};
    },
  };
}

let modNotifier = null;

/**
 * Tells the moderators that something new is waiting in the admin area.
 * Safe to call from anywhere: does nothing without DISCORD_MOD_WEBHOOK_URL and
 * never throws.
 */
export function notifyModerators(kind, reason = null) {
  try {
    if (!webhookFromEnv('DISCORD_MOD_WEBHOOK_URL')) return;
    modNotifier ||= createModNotifier({
      send: async (batch) => (await post('DISCORD_MOD_WEBHOOK_URL', moderatorMessage(batch))).ok,
    });
    modNotifier.notify(kind, reason);
  } catch (err) {
    warnOnce('notify', `moderator heads-up failed (${err.message})`);
  }
}

/** One test message to the moderators' channel (scripts/announce.mjs --mod-test). */
export function sendModeratorTest() {
  return post('DISCORD_MOD_WEBHOOK_URL', moderatorMessage({ report: { total: 1, reasons: new Map([['other', 1]]) } }));
}

/** only for tests */
export function resetWebhooks() {
  modNotifier?.stop();
  modNotifier = null;
  warned.clear();
}

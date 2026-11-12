/**
 * GeoTime.lol – Slash-Command /beta (eigene Discord-App, nicht die von LaughTime)
 *
 * Discord schickt Slash-Commands als HTTP-POST an die "Interactions Endpoint URL":
 *     https://geotime.lol/geotime-api/discord/interactions
 *
 *   /beta start          neue Beta-Instanz auf einem freien Port
 *   /beta stop <id>      Instanz stoppen
 *   /beta list           laufende Instanzen zeigen
 *
 * Nur IDs aus GEOTIME_DISCORD_ADMINS dürfen das; jede Anfrage wird über die
 * Ed25519-Signatur von Discord geprüft (in Node eingebaut, keine Abhängigkeit).
 */
import crypto from 'node:crypto';

const PING = 1;
const APPLICATION_COMMAND = 2;
const CHANNEL_MESSAGE = 4;
const EPHEMERAL = 1 << 6;

export function verifySignature({ publicKey, signature, timestamp, body }) {
  if (!publicKey || !signature || !timestamp) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

const reply = (content) => ({ type: CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL } });

export async function handleInteraction(interaction, { cfg, instances }) {
  if (interaction.type === PING) return { type: 1 };
  if (interaction.type !== APPLICATION_COMMAND) return reply('Unbekannte Interaktion.');

  const user = interaction.member?.user || interaction.user || {};
  const admins = cfg.discord.adminIds;
  if (admins.length && !admins.includes(String(user.id))) return reply('Das darf nur das GeoTime-Team.');

  const sub = interaction.data?.options?.[0];
  const action = sub?.name || 'list';
  const value = (name) => sub?.options?.find((o) => o.name === name)?.value;

  try {
    if (action === 'start') {
      const res = await instances.start({ id: value('id'), channel: 'beta', by: user.username || 'discord' });
      return reply(
        `Beta-Instanz **${res.id}** läuft auf Port **${res.port}**.\n` +
          'Dateien in `geotime/updates/beta/` greifen sofort – ohne Neustart.',
      );
    }
    if (action === 'stop') {
      const id = value('id');
      if (!id) return reply('Welche Instanz? `/beta stop id:beta-1`');
      await instances.stop(id);
      return reply(`Instanz **${id}** gestoppt.`);
    }
    const running = instances.list();
    if (!running.length) return reply('Gerade läuft keine Instanz.');
    return reply(
      ['**GeoTime-Instanzen**', ...running.map((i) => `• \`${i.id}\` · Port ${i.port} · ${i.channel} · seit ${Math.round(i.uptimeMs / 60000)} min`)].join('\n'),
    );
  } catch (err) {
    return reply(`Fehler: ${err.message}`);
  }
}

/** /beta einmalig bei Discord anmelden (beim Start der Produktionsinstanz) */
export async function registerCommands(cfg, { log = console.log } = {}) {
  const { clientId, botToken, apiUrl } = cfg.discord;
  if (!clientId || !botToken) return false;
  const body = [
    {
      name: 'beta',
      description: 'GeoTime Beta-Instanzen verwalten',
      type: 1,
      options: [
        {
          name: 'start',
          description: 'Neue Beta-Instanz auf einem freien Port starten',
          type: 1,
          options: [{ name: 'id', description: 'Eigener Name (optional)', type: 3, required: false }],
        },
        {
          name: 'stop',
          description: 'Beta-Instanz stoppen',
          type: 1,
          options: [{ name: 'id', description: 'z. B. beta-1', type: 3, required: true }],
        },
        { name: 'list', description: 'Laufende Instanzen anzeigen', type: 1 },
      ],
    },
  ];
  try {
    const res = await fetch(`${apiUrl}/v10/applications/${clientId}/commands`, {
      method: 'PUT',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('Slash-Command /beta ist angemeldet.');
    return true;
  } catch (err) {
    log(`/beta konnte nicht angemeldet werden: ${err.message}`);
    return false;
  }
}

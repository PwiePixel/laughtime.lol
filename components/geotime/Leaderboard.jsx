'use client';

/**
 * Bestenliste von GeoTime – eigene Zahlen aus der eigenen Datenbank,
 * im Design von LaughTime (.chips, .chip, .card).
 */
import { useEffect, useState } from 'react';
import { useGeo } from './GeoProviders';

const GAMES = [
  ['classic', 'lb.classic'],
  ['bingo', 'lb.bingo'],
];
const RANGES = [
  ['all', 'lb.all'],
  ['30d', 'lb.30d'],
  ['7d', 'lb.7d'],
];

export default function Leaderboard() {
  const { t, account } = useGeo();
  const [game, setGame] = useState('classic');
  const [range, setRange] = useState('all');
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    let dead = false;
    setEntries(null);
    fetch(`/geotime-api/leaderboard?game=${game}&range=${range}`)
      .then((r) => r.json())
      .then((d) => !dead && setEntries(d.entries || []))
      .catch(() => !dead && setEntries([]));
    return () => {
      dead = true;
    };
  }, [game, range]);

  return (
    <>
      <h1>{t('lb.title')}</h1>

      <div className="chips">
        {GAMES.map(([key, label]) => (
          <button key={key} type="button" className={`chip ${game === key ? 'on' : ''}`} onClick={() => setGame(key)}>
            {t(label)}
          </button>
        ))}
      </div>
      <div className="chips top-gap">
        {RANGES.map(([key, label]) => (
          <button key={key} type="button" className={`chip ${range === key ? 'on' : ''}`} onClick={() => setRange(key)}>
            {t(label)}
          </button>
        ))}
      </div>

      {entries === null && <p className="muted top-gap">…</p>}
      {entries?.length === 0 && <p className="muted top-gap">{t('lb.empty')}</p>}

      {entries?.length > 0 && (
        <ol className="geo-list geo-lb top-gap">
          {entries.map((e) => (
            <li key={e.username} className={`card geo-row ${account?.username === e.username ? 'me' : ''}`}>
              <strong>
                {e.rank}. {e.name || e.username}
                {account?.username === e.username ? ` · ${t('lb.you')}` : ''}
              </strong>
              <span className="muted small">
                {e.games} {t('lb.games')}
              </span>
              <span className="geo-points">{e.points.toLocaleString('de-DE')}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Avatar from './Avatar';
import Icon from './Icon';
import { useApp } from './Providers';

const METRICS = [
  { key: 'points', icon: 'star' },
  { key: 'wins', icon: 'trophy' },
  { key: 'round_wins', icon: 'crown' },
  { key: 'likes', icon: 'heart' },
  { key: 'games', icon: 'gamepad' },
];
const PERIODS = ['week', 'month', 'all'];

export function Podium({ rows, t, nf }) {
  const order = [rows[1], rows[0], rows[2]];
  return (
    <div className="podium lb-podium">
      {order.map((r, i) =>
        r ? (
          <Link key={r.user.username} href={`/u/${r.user.username}`} className={`podium-spot place-${[2, 1, 3][i]}`}>
            <Avatar value={r.user.avatar} size={[64, 84, 56][i]} />
            <strong className="podium-name">{r.user.displayName}</strong>
            <span className="podium-score">{nf.format(r.value)}</span>
            <div className="podium-block">{[2, 1, 3][i]}</div>
          </Link>
        ) : (
          <div key={`e${i}`} className="podium-spot is-empty" />
        ),
      )}
    </div>
  );
}

export default function LeaderboardPage() {
  const { t, lang, account } = useApp();
  const [metric, setMetric] = useState('points');
  const [period, setPeriod] = useState('week');
  const [rows, setRows] = useState(null);
  const nf = new Intl.NumberFormat(lang);

  useEffect(() => {
    let alive = true;
    setRows(null);
    api(`/api/leaderboard?metric=${metric}&period=${period}`)
      .then((d) => alive && setRows(d.rows))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [metric, period]);

  return (
    <div className="page-wide leaderboard-page">
      <div className="page-head">
        <div>
          <h1>{t('lb.title')}</h1>
          <p className="muted">{t('lb.sub')}</p>
        </div>
        <div className="chips" role="radiogroup" aria-label={t('lb.period')}>
          {PERIODS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={period === p} className={`chip ${period === p ? 'on' : ''}`} onClick={() => setPeriod(p)}>
              {t(`period.${p}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="tabs wide" role="tablist">
        {METRICS.map((m) => (
          <button key={m.key} type="button" role="tab" aria-selected={metric === m.key} className={metric === m.key ? 'on' : ''} onClick={() => setMetric(m.key)}>
            <Icon name={m.icon} size={18} />
            {t(`lb.metric.${m.key}`)}
          </button>
        ))}
      </div>

      {rows === null ? (
        <div className="page-center">
          <div className="spinner" aria-hidden="true" />
        </div>
      ) : rows.length === 0 ? (
        <div className="card center empty-card">
          <div className="big-icon">
            <Icon name="podium" size={52} />
          </div>
          <p className="lead">{t('lb.empty')}</p>
          <Link className="btn btn-yellow" href="/">
            <Icon name="play" /> {t('nav.play')}
          </Link>
        </div>
      ) : (
        <>
          <Podium rows={rows} t={t} nf={nf} />
          <div className="card lb-table-wrap">
            <table className="lb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('lb.player')}</th>
                  <th className="num">{t(`lb.metric.${metric}`)}</th>
                  <th className="num hide-sm">{t('stats.games')}</th>
                  <th className="num hide-sm">{t('stats.wins')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user.username} className={account?.username === r.user.username ? 'is-me' : ''}>
                    <td className="rank">{r.rank}</td>
                    <td>
                      <Link href={`/u/${r.user.username}`} className="lb-user">
                        <Avatar value={r.user.avatar} size={34} />
                        <span>
                          <strong>{r.user.displayName}</strong>
                          <small className="muted">@{r.user.username}</small>
                        </span>
                      </Link>
                    </td>
                    <td className="num strong">{nf.format(r.value)}</td>
                    <td className="num hide-sm">{metric === 'likes' ? '–' : nf.format(r.games)}</td>
                    <td className="num hide-sm">{metric === 'likes' ? '–' : nf.format(r.wins)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!account && (
        <p className="center-text lb-cta">
          {t('lb.joinHint')}{' '}
          <Link href="/login?mode=register">{t('auth.register')}</Link>
        </p>
      )}
    </div>
  );
}

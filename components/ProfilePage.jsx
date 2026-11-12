'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Avatar from './Avatar';
import Icon from './Icon';
import { reportHttp } from './ReportDialog';
import useReport from './useReport';
import MemeCard from './MemeCard';
import { useApp } from './Providers';

function Stat({ icon, value, label, accent }) {
  return (
    <div className={`stat-tile ${accent || ''}`}>
      <Icon name={icon} size={22} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function ProfilePage({ username }) {
  const { t, lang } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [openReport, reportDialog] = useReport();

  useEffect(() => {
    let alive = true;
    setData(null);
    api(`/api/users/${encodeURIComponent(username)}`)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.code));
    return () => {
      alive = false;
    };
  }, [username]);

  if (error) {
    return (
      <div className="page-narrow center">
        <div className="card">
          <div className="big-icon">
            <Icon name="search-x" size={56} />
          </div>
          <p className="lead">{t(error === 'user_not_found' ? 'profile.notFound' : 'err.network')}</p>
          <Link className="btn btn-yellow" href="/leaderboard">
            {t('nav.leaderboard')}
          </Link>
        </div>
      </div>
    );
  }
  if (!data) return <div className="page-center">{t('common.loading')}</div>;

  const { user, stats, memes } = data;
  const nf = new Intl.NumberFormat(lang);
  const winRate = stats.games ? Math.round((stats.wins / stats.games) * 100) : 0;
  const updateMeme = (m) => setData((d) => ({ ...d, memes: d.memes.map((x) => (x.id === m.id ? m : x)) }));
  const removeMeme = async (m) => {
    if (!window.confirm(t('memes.confirmDelete'))) return;
    await api(`/api/memes/${m.id}`, { method: 'DELETE' }).catch(() => {});
    setData((d) => ({ ...d, memes: d.memes.filter((x) => x.id !== m.id) }));
  };

  return (
    <div className="page-wide profile-page">
      <section className="card profile-head">
        <Avatar value={user.avatar} size={112} />
        <div className="profile-id">
          <h1>{user.displayName}</h1>
          <p className="muted">
            @{user.username} · {t('profile.since', { date: new Date(user.createdAt).toLocaleDateString(lang, { month: 'long', year: 'numeric' }) })}
          </p>
          {user.bio && <p className="profile-bio">{user.bio}</p>}
        </div>
        <div className="profile-side">
          {stats.rank && (
            <div className="rank-chip">
              <Icon name="medal" size={20} />
              {t('profile.rank', { n: stats.rank })}
            </div>
          )}
          {!user.isMe && (
            <button
              type="button"
              className="btn btn-small btn-ghost report-profile"
              onClick={() => openReport({ kind: 'player', name: user.displayName, avatar: user.avatar }, reportHttp({ username: user.username }))}
            >
              <Icon name="flag" size={16} /> {t('report.profile')}
            </button>
          )}
          {user.isMe && (
            <Link className="btn btn-small btn-white" href="/account">
              <Icon name="settings" size={16} /> {t('nav.settings')}
            </Link>
          )}
        </div>
      </section>

      <section className="stat-grid">
        <Stat icon="star" value={nf.format(stats.points)} label={t('stats.points')} accent="yellow" />
        <Stat icon="trophy" value={nf.format(stats.wins)} label={t('stats.wins')} accent="pink" />
        <Stat icon="gamepad" value={nf.format(stats.games)} label={t('stats.games')} accent="cyan" />
        <Stat icon="target" value={`${winRate}%`} label={t('stats.winRate')} />
        <Stat icon="crown" value={nf.format(stats.roundWins)} label={t('stats.roundWins')} />
        <Stat icon="heart" value={nf.format(stats.likes)} label={t('stats.likes')} />
        <Stat icon="image" value={nf.format(stats.memes)} label={t('stats.memes')} />
        <Stat icon="zap" value={nf.format(stats.bestGame)} label={t('stats.bestGame')} />
      </section>

      <h2 className="section-title">{t('profile.memes')}</h2>
      {memes.length ? (
        <div className="meme-grid">
          {memes.map((m) => (
            <MemeCard key={m.id} meme={m} showAuthor={false} onChange={updateMeme} onDelete={removeMeme} />
          ))}
        </div>
      ) : null}
      {user.isMe && memes.some((m) => m.private) && (
        <p className="private-note">
          <Icon name="eye-off" size={18} /> {t('profile.privateMemes')} <Link href="/account">{t('nav.settings')}</Link>
        </p>
      )}
      {reportDialog}
      {!memes.length && <p className="empty-note">{t(user.isMe ? 'profile.noMemesMe' : 'profile.noMemes')}</p>}
      {memes.length >= 12 && (
        <p className="center-text">
          <Link className="btn btn-white" href={`/memes?user=${encodeURIComponent(user.username)}`}>
            {t('profile.allMemes')}
          </Link>
        </p>
      )}
    </div>
  );
}

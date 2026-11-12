'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ROOM_CODE_RE, sanitizeName } from '@/lib/shared';
import Link from 'next/link';
import { api } from '@/lib/api';
import { usePublicInfo } from '@/lib/usePublicInfo';
import Avatar from './Avatar';
import AvatarPicker from './AvatarPicker';
import GamePicker from './GamePicker';
import Icon from './Icon';
import LolLogo from './LolLogo';
import MemeCanvas from './MemeCanvas';
import MemeCard from './MemeCard';
import { useApp } from './Providers';
import NewsTeaser from './v2/NewsTeaser';

function Sparkle({ className, color = '#fff' }) {
  return (
    <svg className={`sparkle ${className}`} viewBox="0 0 40 40" aria-hidden="true">
      <path
        d="M20 2 Q23.6 16.4 38 20 Q23.6 23.6 20 38 Q16.4 23.6 2 20 Q16.4 16.4 20 2Z"
        fill={color}
        stroke="#170A2E"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SOURCE_LABELS = { imgflip: 'Imgflip', giphy: 'GIPHY', klipy: 'KLIPY', reddit: 'Reddit' };

const SAMPLE = {
  en: ['when the group chat\ngoes silent', 'me pretending to\nunderstand the rules', 'nobody:\nabsolutely nobody:'],
  de: ['wenn der Gruppenchat\nplötzlich still ist', 'ich, wenn ich so tue,\nals würde ich die Regeln verstehen', 'niemand:\nwirklich niemand:'],
};

function sampleCaption(text, y) {
  return [{ text, x: 50, y, w: 94, size: 9, color: '#FFFFFF', upper: true }];
}

export default function HomeClient() {
  const router = useRouter();
  const { t, lang, profile, updateProfile, account } = useApp();
  const [community, setCommunity] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [showcase, setShowcase] = useState([]);
  const [sources, setSources] = useState(['imgflip']);
  const [picker, setPicker] = useState(null); // 'quick' | 'private'
  const publicInfo = usePublicInfo(20000);
  const onlineNow = (publicInfo.classic?.players || 0) + (publicInfo.hunt?.players || 0);

  useEffect(() => {
    if (profile) setName(profile.name || '');
  }, [profile]);

  useEffect(() => {
    let alive = true;
    fetch('/api/showcase')
      .then((r) => r.json())
      .then((d) => alive && setShowcase(d.items || []))
      .catch(() => {});
    api('/api/community')
      .then((d) => alive && setCommunity(d))
      .catch(() => alive && setCommunity({ topPlayers: [], topMemes: [], stats: {} }));
    fetch('/api/sources')
      .then((r) => r.json())
      .then((d) => alive && d.sources?.length && setSources(d.sources))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const cleanName = sanitizeName(name);

  function requireName() {
    if (account) return true;
    if (!cleanName) {
      setError(t('err.name_required'));
      document.getElementById('home-name')?.focus();
      return false;
    }
    updateProfile({ name: cleanName });
    return true;
  }

  function openPicker(kind) {
    setError('');
    if (!requireName()) return;
    setPicker(kind);
  }

  async function pickGame(game) {
    if (picker === 'quick') {
      setBusy(game);
      router.push(`/play?game=${game}`);
      return;
    }
    await createRoom(game);
  }

  async function createRoom(game) {
    setError('');
    setBusy(game);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.code) throw new Error(data.error || 'network');
      router.push(`/room/${data.code}`);
    } catch (err) {
      const k = `err.${err.message}`;
      setError(t(k) === k ? t('err.network') : t(k));
      setBusy(null);
      setPicker(null);
    }
  }

  async function joinRoom(e) {
    e.preventDefault();
    setError('');
    const c = code.trim().toUpperCase();
    if (!ROOM_CODE_RE.test(c)) return setError(t('err.code_invalid'));
    if (!requireName()) return;
    setBusy('join');
    try {
      const info = await fetch(`/api/rooms/${c}`).then((r) => r.json());
      if (!info.exists) throw new Error('room_not_found');
      if (info.full) throw new Error('room_full');
      router.push(`/room/${c}`);
    } catch (err) {
      const k = `err.${err.message}`;
      setError(t(k) === k ? t('err.network') : t(k));
      setBusy(null);
    }
  }

  const sourceText = sources.map((s) => SOURCE_LABELS[s] || s).join(', ');

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <Sparkle className="s1" />
          <Sparkle className="s2" color="#FFD23F" />
          <Sparkle className="s3" color="#FF4FA3" />
          <LolLogo className="hero-logo" />
          <h1 className="hero-title">
            {t('home.title')
              .split('\n')
              .map((line, i) => (
                <span key={line} className={i === 1 ? 'hl' : ''}>
                  {line}
                </span>
              ))}
          </h1>
          <p className="hero-sub">{t('home.sub')}</p>
          <ul className="feature-list">
            <li>
              <Icon name="image" className="feat-icon" /> {t('home.feat1')}
            </li>
            <li>
              <Icon name="users" className="feat-icon" /> {t('home.feat2')}
            </li>
            <li>
              <Icon name="trophy" className="feat-icon" /> {t('home.feat3')}
            </li>
          </ul>
        </div>

        <div className="card play-card">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              openPicker('quick');
            }}
          >
            {account ? (
              <div className="playing-as">
                <Avatar value={account.avatar} size={64} />
                <div>
                  <span className="muted small">{t('home.playingAs')}</span>
                  <strong>{account.displayName}</strong>
                  <Link href={`/u/${account.username}`} className="small">
                    {t('home.viewStats')}
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <label className="label" htmlFor="home-name">
                  {t('home.nameLabel')}
                </label>
                <input
                  id="home-name"
                  className="input"
                  value={name}
                  maxLength={20}
                  autoComplete="nickname"
                  placeholder={t('home.namePlaceholder')}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => cleanName && updateProfile({ name: cleanName })}
                />
                <span className="label">{t('home.avatarLabel')}</span>
                {profile && <AvatarPicker value={profile.avatar} onChange={(avatar) => updateProfile({ avatar })} />}
              </>
            )}
            <div className="mode-tiles">
              <button type="submit" className="mode-tile tile-quick" disabled={Boolean(busy)}>
                <span className="tile-icon">
                  <Icon name="globe" size={34} />
                </span>
                <span className="tile-text">
                  <strong>{t('home.quick')}</strong>
                  <small>{t('home.quickSub')}</small>
                </span>
                {onlineNow > 0 && (
                  <span className="tile-live">
                    <span className="live-dot" /> {t('home.online', { n: onlineNow })}
                  </span>
                )}
              </button>
              <button type="button" className="mode-tile tile-private" disabled={Boolean(busy)} onClick={() => openPicker('private')}>
                <span className="tile-icon">
                  <Icon name="lock" size={30} />
                </span>
                <span className="tile-text">
                  <strong>{t('home.private')}</strong>
                  <small>{t('home.privateSub')}</small>
                </span>
              </button>
            </div>
          </form>
          <div className="divider">
            <span>{t('home.or')}</span>
          </div>
          <form className="join-row" onSubmit={joinRoom}>
            <input
              className="input code-input"
              value={code}
              maxLength={5}
              placeholder={t('home.codePlaceholder')}
              aria-label={t('home.codePlaceholder')}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <button className="btn btn-cyan" disabled={Boolean(busy)} type="submit">
              {busy === 'join' ? '…' : t('home.join')}
            </button>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!account && (
            <p className="guest-hint small">
              <Icon name="medal" size={16} /> {t('home.accountHint')}{' '}
              <Link href="/login?mode=register">{t('auth.register')}</Link>
            </p>
          )}
        </div>
      </section>

      {picker && <GamePicker purpose={picker} busy={busy} onPick={pickGame} onClose={() => !busy && setPicker(null)} />}

      <NewsTeaser />

      {community && (community.topMemes?.length > 0 || community.topPlayers?.length > 0) && (
        <section className="community">
          <div className="community-memes">
            <div className="section-row">
              <h2>{t('home.topMemes')}</h2>
              <Link href="/memes" className="more-link">
                {t('home.seeAll')} <Icon name="arrow-right" size={16} />
              </Link>
            </div>
            {community.topMemes.length ? (
              <div className="meme-grid compact">
                {community.topMemes.map((m) => (
                  <MemeCard
                    key={m.id}
                    meme={m}
                    onChange={(nm) =>
                      setCommunity((c) => ({ ...c, topMemes: c.topMemes.map((x) => (x.id === nm.id ? nm : x)) }))
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="empty-note">{t('memes.empty')}</p>
            )}
          </div>
          <aside className="card community-players">
            <h2>{t('home.topPlayers')}</h2>
            {community.topPlayers.length ? (
              <ol className="mini-board">
                {community.topPlayers.map((r) => (
                  <li key={r.user.username}>
                    <span className="rank">{r.rank}</span>
                    <Link href={`/u/${r.user.username}`} className="lb-user">
                      <Avatar value={r.user.avatar} size={32} />
                      <span>{r.user.displayName}</span>
                    </Link>
                    <span className="lb-score">
                      {r.value} {t('common.pts')}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">{t('lb.empty')}</p>
            )}
            <Link href="/leaderboard" className="btn btn-white btn-block">
              <Icon name="podium" size={18} /> {t('nav.leaderboard')}
            </Link>
          </aside>
        </section>
      )}

      {showcase.length > 0 && !(community?.topMemes?.length > 0) && (
        <section className="showcase" aria-hidden="true">
          {showcase.map((m, i) => (
            <div key={m.src} className={`showcase-card tilt-${i}`}>
              <MemeCanvas
                media={m}
                captions={sampleCaption(SAMPLE[lang]?.[i] || SAMPLE.en[i], m.kind === 'video' ? 84 : 14)}
                maxHeight="300px"
                onFail={() => setShowcase((list) => list.filter((x) => x.src !== m.src))}
              />
            </div>
          ))}
        </section>
      )}

      <section className="how" id="how">
        <h2 className="section-title">{t('home.how')}</h2>
        <div className="steps">
          {[1, 2, 3].map((n) => (
            <div key={n} className={`card step step-${n}`}>
              <span className="step-num">{n}</span>
              <h3>{t(`home.step${n}.title`)}</h3>
              <p>{t(`home.step${n}.text`)}</p>
            </div>
          ))}
        </div>
        <p className="sources-note">{t('home.sources', { sources: sourceText })}</p>
      </section>
    </div>
  );
}

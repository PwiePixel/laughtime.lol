'use client';

/**
 * Startseite von GeoTime – Aufbau und Klassen sind 1:1 die von LaughTimes
 * Startseite (.home, .hero, .hero-copy, .hero-title, .feature-list,
 * .card.play-card, .mode-tiles, .divider, .join-row). Nur der Inhalt gehört
 * GeoTime: zwei Spielarten statt Meme-Räume.
 *
 * Von hier geht es mit der Wahl direkt in die Runde (/play).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AvatarPicker from '@/components/AvatarPicker';
import Icon from '@/components/Icon';
import { randomAvatar, sanitizeAvatar } from '@/lib/shared';
import GeoGamePicker from './GeoGamePicker';
import GeoLogo from './GeoLogo';
import { useGeo } from './GeoProviders';

const NAME_KEY = 'geotime-name';
const AVATAR_KEY = 'geotime-avatar';
const CODE_RE = /^[A-Z0-9]{5}$/;

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

export default function GeoHome() {
  const { t, account } = useGeo();
  const router = useRouter();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('cat|0');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  // 'quick' = allein sofort los, 'private' = eigener Raum mit Code
  const [picker, setPicker] = useState(null);

  useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) || '');
      const saved = localStorage.getItem(AVATAR_KEY);
      // beim ersten Mal ein zufälliges Bildchen, damit nicht alle gleich aussehen
      const start = saved ? sanitizeAvatar(saved) : randomAvatar();
      setAvatar(start);
      if (!saved) localStorage.setItem(AVATAR_KEY, start);
    } catch {
      /* privates Fenster */
    }
  }, []);

  const rememberAvatar = (value) => {
    const clean = sanitizeAvatar(value);
    setAvatar(clean);
    try {
      localStorage.setItem(AVATAR_KEY, clean);
    } catch {
      /* egal */
    }
  };

  const remember = (value) => {
    setName(value);
    try {
      localStorage.setItem(NAME_KEY, value);
    } catch {
      /* egal */
    }
  };

  /**
   * Erst die Art des Spiels, dann die Spielart – wie bei LaughTime.
   * quick   -> sofort losspielen
   * private -> eigener Raum, Lobby mit Code zum Weitergeben
   */
  const start = (game) => router.push(`/play?game=${game}${picker === 'private' ? '&room=1' : ''}`);

  const join = (e) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!CODE_RE.test(c)) return setError(t('home.badCode'));
    return router.push(`/play?code=${c}`);
  };

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <Sparkle className="s1" />
          <Sparkle className="s2" color="#FFD23F" />
          <Sparkle className="s3" color="#FF4FA3" />
          <GeoLogo className="hero-logo" />
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
              <Icon name="globe" className="feat-icon" /> {t('home.feat1')}
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
          {account ? (
            <div className="playing-as">
              <span className="geo-avatar geo-avatar-big" aria-hidden="true">
                {(account.name || account.username || '?').slice(0, 1).toUpperCase()}
              </span>
              <div>
                <span className="muted small">{t('home.playingAs')}</span>
                <strong>{account.name || account.username}</strong>
                <Link href="/leaderboard" className="small">
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
                onChange={(e) => remember(e.target.value)}
              />
              <span className="label">{t('home.avatarLabel')}</span>
              <AvatarPicker value={avatar} onChange={rememberAvatar} />
            </>
          )}

          <div className="mode-tiles">
            <button type="button" className="mode-tile tile-quick" onClick={() => setPicker('quick')}>
              <span className="tile-icon">
                <Icon name="globe" size={34} />
              </span>
              <span className="tile-text">
                <strong>{t('home.quick')}</strong>
                <small>{t('home.quickSub')}</small>
              </span>
            </button>
            <button type="button" className="mode-tile tile-private" onClick={() => setPicker('private')}>
              <span className="tile-icon">
                <Icon name="lock" size={30} />
              </span>
              <span className="tile-text">
                <strong>{t('home.private')}</strong>
                <small>{t('home.privateSub')}</small>
              </span>
            </button>
          </div>

          <div className="divider">
            <span>{t('home.or')}</span>
          </div>

          <form className="join-row" onSubmit={join}>
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
            <button className="btn btn-cyan" type="submit">
              {t('home.join')}
            </button>
          </form>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {!account && (
            <p className="guest-hint small">
              <Icon name="medal" size={16} /> {t('home.accountHint')} <Link href="/login">{t('auth.register')}</Link>
            </p>
          )}
        </div>
      </section>

      <section className="how geo-how" id="how">
        <h2 className="section-title">{t('how.title')}</h2>
        <div className="steps">
          {[1, 2, 3].map((n) => (
            <div key={n} className={`card step step-${n}`}>
              <span className="step-num">{n}</span>
              <h3>{t(`how.s${n}.title`)}</h3>
              <p>{t(`how.s${n}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      {picker && <GeoGamePicker purpose={picker} onPick={start} onClose={() => setPicker(null)} />}
    </div>
  );
}

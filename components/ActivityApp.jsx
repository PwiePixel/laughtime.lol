'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { isActivityUrl, openExternal, setActivitySdk, setActivitySession } from '@/lib/activity';
import { ActivityContext } from './ActivityContext';
import GalleryPage from './GalleryPage';
import GameRoom from './GameRoom';
import Header from './Header';
import Icon from './Icon';
import LeaderboardPage from './LeaderboardPage';
import LolLogo from './LolLogo';
import MemePage from './MemePage';
import ProfilePage from './ProfilePage';
import { useApp } from './Providers';

const SCOPES = ['identify', 'rpc.activities.write'];
const READY_TIMEOUT = 15_000;
const LAYOUT_PIP = 1;

const withTimeout = (promise, ms, code) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new ApiError(code, 0)), ms))]);

/** Loading screen with the bouncing LoL logo */
function Boot({ step, error, onRetry }) {
  const { t } = useApp();
  return (
    <div className="activity-boot">
      <div className="mm-visual" aria-hidden="true">
        <span className="mm-ring r1" />
        <span className="mm-ring r2" />
        <span className="mm-ring r3" />
        <LolLogo className="mm-logo" />
      </div>
      {error ? (
        <div className="activity-error" role="alert">
          <p className="lead">{t(`activity.err.${error}`) === `activity.err.${error}` ? t('activity.err.generic') : t(`activity.err.${error}`)}</p>
          {onRetry && (
            <button type="button" className="btn btn-yellow" onClick={onRetry}>
              <Icon name="repeat" /> {t('activity.retry')}
            </button>
          )}
        </div>
      ) : (
        <h1 className="mm-title" aria-live="polite">
          {t(`activity.step.${step}`)}
          <span className="mm-dots">
            <i />
            <i />
            <i />
          </span>
        </h1>
      )}
    </div>
  );
}

/** Opened in a normal browser: explain where the activity lives */
function Outside() {
  const { t } = useApp();
  return (
    <div className="page-narrow center">
      <div className="card activity-outside">
        <div className="big-icon discord-big">
          <Icon name="discord" size={56} />
        </div>
        <h1>{t('activity.outside.title')}</h1>
        <p className="lead">{t('activity.outside.text')}</p>
        <a className="btn btn-yellow" href="/">
          <Icon name="play" /> {t('activity.outside.web')}
        </a>
      </div>
    </div>
  );
}

const GAME = { name: 'game' };
// phases that need the player: switch back to the game when one starts
const ACTION_PHASES = new Set(['starting', 'upload', 'caption', 'vote']);

/**
 * Which activity view a website link stands for (null = open it in the browser).
 * Best memes, leaderboard, profiles and single memes stay inside Discord.
 */
function viewFor(url) {
  if (url.origin !== window.location.origin) return null;
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/activity' || p === '/play' || p === '/room') return GAME;
  if (p === '/memes') return { name: 'memes', user: url.searchParams.get('user') || null };
  if (p === '/leaderboard') return { name: 'leaderboard' };
  let m = /^\/u\/([^/]+)$/.exec(p);
  if (m) return { name: 'profile', username: decodeURIComponent(m[1]) };
  m = /^\/m\/([A-Za-z0-9_-]+)$/.exec(p);
  if (m) return { name: 'meme', id: m[1] };
  return null;
}

const sameView = (a, b) => a.name === b.name && a.user === b.user && a.username === b.username && a.id === b.id;

/** "a round is running" – shown while the player looks at memes or the leaderboard */
function GameBanner({ info, onBack }) {
  const { t } = useApp();
  if (!info || info.phase === 'lobby') return null;
  const text =
    info.phase === 'final'
      ? t('activity.banner.final')
      : info.phase === 'scores'
        ? t('activity.banner.scores', { n: info.round })
        : t('activity.banner.round', { n: info.round, total: info.rounds });
  return (
    <button type="button" className={`activity-banner ${ACTION_PHASES.has(info.phase) ? 'is-live' : ''}`} onClick={onBack}>
      <span className="live-dot" aria-hidden="true" />
      <span>{text}</span>
      <strong>
        {t('activity.banner.back')} <Icon name="play" size={16} />
      </strong>
    </button>
  );
}

export default function ActivityApp() {
  const { t, lang, setLang, refreshAccount, setActivityMode } = useApp();
  const [phase, setPhase] = useState('boot'); // boot | room | error | outside
  const [view, setView] = useState(GAME);
  const [gameInfo, setGameInfo] = useState(null);
  const gameInfoRef = useRef(null);
  const historyRef = useRef([]);
  const viewRef = useRef(GAME);
  viewRef.current = view;
  const [step, setStep] = useState('connect'); // connect | login | room
  const [error, setError] = useState(null);
  const [code, setCode] = useState(null);
  const [roomKey, setRoomKey] = useState(0);
  const [pip, setPip] = useState(false);
  const sdkRef = useRef(null);
  const cfgRef = useRef(null);
  const presenceRef = useRef('');
  const rejoinRef = useRef(0);
  const langRef = useRef(lang);
  langRef.current = lang;

  // the layout's header hides itself – this component shows the only one
  useLayoutEffect(() => {
    setActivityMode(true);
    return () => setActivityMode(false);
  }, [setActivityMode]);

  const go = useCallback((next, { push = true } = {}) => {
    const cur = viewRef.current;
    if (sameView(cur, next)) return;
    if (push && next.name !== 'game') historyRef.current = [...historyRef.current, cur].slice(-20);
    if (next.name === 'game') historyRef.current = [];
    setView(next);
    window.scrollTo(0, 0);
  }, []);

  const back = useCallback(() => {
    const prev = historyRef.current.pop();
    setView(prev || GAME);
    window.scrollTo(0, 0);
  }, []);

  /** open a website path: inside the activity when possible, otherwise in the browser */
  const navigate = useCallback(
    (href) => {
      const url = new URL(href, window.location.href);
      const target = viewFor(url);
      if (target) return go(target);
      const base = cfgRef.current?.publicUrl || window.location.origin;
      openExternal(url.origin === window.location.origin ? new URL(url.pathname + url.search, base).toString() : url.toString());
      return undefined;
    },
    [go],
  );

  const joinRoom = useCallback(async () => {
    const sdk = sdkRef.current;
    setStep('room');
    const res = await api('/api/activity/room', {
      method: 'POST',
      body: { instanceId: sdk.instanceId, guildId: sdk.guildId, channelId: sdk.channelId },
    });
    setCode(res.code);
    setRoomKey((k) => k + 1);
    setPhase('room');
  }, []);

  const boot = useCallback(async () => {
    setError(null);
    setPhase('boot');
    setStep('connect');
    try {
      const cfg = await api('/api/activity/config');
      if (!cfg.enabled || !cfg.clientId) throw new ApiError('activity_disabled', 404);
      cfgRef.current = cfg;

      let sdk = sdkRef.current;
      if (!sdk) {
        const { DiscordSDK } = await import('@discord/embedded-app-sdk');
        sdk = new DiscordSDK(cfg.clientId, { disableConsoleLogOverride: true });
        sdkRef.current = sdk;
      }
      await withTimeout(sdk.ready(), READY_TIMEOUT, 'discord_timeout');

      // login: Discord asks once, afterwards this is silent
      setStep('login');
      let auth;
      try {
        auth = await sdk.commands.authorize({ client_id: cfg.clientId, response_type: 'code', state: '', prompt: 'none', scope: SCOPES });
      } catch (err) {
        // user closed the dialog (code 5000) or a scope is not available: try the basic one
        if (err?.code === 5000) throw new ApiError('discord_denied', 401);
        try {
          auth = await sdk.commands.authorize({ client_id: cfg.clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
        } catch {
          throw new ApiError('discord_denied', 401);
        }
      }
      const token = await api('/api/activity/token', { method: 'POST', body: { code: auth.code } });
      setActivitySession(token.session);
      setActivitySdk(sdk, token.accessToken, cfg.clientId);
      try {
        await sdk.commands.authenticate({ access_token: token.accessToken });
      } catch (err) {
        console.warn('[activity] authenticate failed', err);
      }
      await refreshAccount();

      // Discord's language (only once, the switch in the bar still works)
      try {
        const { locale } = await sdk.commands.userSettingsGetLocale();
        const wanted = String(locale || '').toLowerCase().startsWith('de') ? 'de' : 'en';
        if (wanted !== langRef.current) setLang(wanted, { refresh: false });
      } catch {
        /* not available */
      }

      if (!sdk.lt_layoutSubscribed) {
        sdk.lt_layoutSubscribed = true;
        Promise.resolve()
          .then(() => sdk.subscribe('ACTIVITY_LAYOUT_MODE_UPDATE', ({ layout_mode: mode }) => setPip(mode === LAYOUT_PIP)))
          .catch(() => {
            /* old client */
          });
      }

      await joinRoom();
    } catch (err) {
      console.warn('[activity] start failed', err);
      if (err instanceof Error && /frame_id|instance_id|platform/.test(err.message)) {
        setPhase('outside');
        return;
      }
      setError(err?.code && typeof err.code === 'string' ? err.code : 'generic');
      setPhase('error');
    }
  }, [joinRoom, refreshAccount, setLang]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!isActivityUrl()) {
      setPhase('outside');
      return;
    }
    boot();
  }, [boot]);

  // links: nothing may navigate the Discord frame away – site pages open as views
  useEffect(() => {
    if (phase === 'outside') return undefined;
    const onClick = (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('blob:') || a.hasAttribute('download')) return;
      e.preventDefault();
      navigate(href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [phase, navigate]);

  const ctx = useMemo(
    () => ({
      platform: sdkRef.current?.platform || 'desktop',
      async invite() {
        try {
          await sdkRef.current.commands.openInviteDialog();
          return true;
        } catch (err) {
          console.warn('[activity] invite failed', err);
          return false;
        }
      },
      close() {
        try {
          sdkRef.current?.close(1000, 'closed by player');
        } catch {
          /* ignore */
        }
      },
      openExternal,
      navigate,
      publicUrl: cfgRef.current?.publicUrl || '',
      onState(state) {
        const prev = gameInfoRef.current;
        if (!prev || prev.phase !== state.phase || prev.round !== state.round || prev.rounds !== state.settings.rounds) {
          const info = { phase: state.phase, round: state.round, rounds: state.settings.rounds };
          gameInfoRef.current = info;
          setGameInfo(info);
          // a new phase that needs the player: back to the game
          if (prev && prev.phase !== state.phase && ACTION_PHASES.has(state.phase) && viewRef.current.name !== 'game') {
            historyRef.current = [];
            setView(GAME);
            window.scrollTo(0, 0);
          }
        }
        const sdk = sdkRef.current;
        if (!sdk) return;
        const players = state.players.filter((p) => p.connected).length;
        const details =
          state.phase === 'lobby' || state.phase === 'starting'
            ? t('activity.presence.lobby')
            : state.phase === 'final'
              ? t('activity.presence.final')
              : t('activity.presence.round', { n: state.round, total: state.settings.rounds });
        const presence = {
          type: 0,
          details,
          state: t(`games.${state.settings.game}`),
          party: { id: sdk.instanceId, size: [Math.max(1, players), state.settings.maxPlayers] },
        };
        const key = JSON.stringify(presence);
        if (key === presenceRef.current) return;
        presenceRef.current = key;
        sdk.commands.setActivity({ activity: presence }).catch(() => {});
      },
      onRoomGone() {
        // the room expired (everyone was away for a while): open a fresh one for this call
        if (Date.now() - rejoinRef.current < 5000) return;
        rejoinRef.current = Date.now();
        joinRoom().catch((err) => {
          setError(err?.code || 'generic');
          setPhase('error');
        });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [joinRoom, t, phase, navigate],
  );

  if (phase === 'outside') return <Outside />;

  const panel =
    view.name === 'memes' ? (
      <GalleryPage key={`memes-${view.user || ''}`} user={view.user} />
    ) : view.name === 'leaderboard' ? (
      <LeaderboardPage />
    ) : view.name === 'profile' ? (
      <ProfilePage key={`u-${view.username}`} username={view.username} />
    ) : view.name === 'meme' ? (
      <MemePage key={`m-${view.id}`} id={view.id} />
    ) : null;

  return (
    <ActivityContext.Provider value={ctx}>
      <div className={`activity-shell ${pip ? 'is-pip' : ''}`}>
        <Header activityView={view.name} />
        <div className="activity-game" hidden={view.name !== 'game'}>
          {phase === 'room' && code ? (
            <GameRoom key={`${code}-${roomKey}`} code={code} />
          ) : (
            <Boot step={step} error={phase === 'error' ? error : null} onRetry={phase === 'error' ? boot : null} />
          )}
        </div>
        {panel && (
          <div className="activity-panel">
            <GameBanner info={phase === 'room' ? gameInfo : null} onBack={() => go(GAME)} />
            {historyRef.current.length > 0 && (view.name === 'profile' || view.name === 'meme') && (
              <button type="button" className="btn btn-small btn-white activity-back" onClick={back}>
                <Icon name="arrow-left" size={16} /> {t('activity.back')}
              </button>
            )}
            <Suspense fallback={<div className="spinner" aria-hidden="true" />}>{panel}</Suspense>
          </div>
        )}
      </div>
    </ActivityContext.Provider>
  );
}

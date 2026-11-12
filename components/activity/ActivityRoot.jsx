'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isActivityUrl, openExternal } from '@/lib/activity';
import { forgetLogin, joinRoom, login, openConnection } from '@/lib/activityBoot';
import { createPresenceThrottle } from '@/lib/activityPresence';
import {
  LAYOUT,
  ORIENTATION_LOCK,
  canSetPresence,
  createCancel,
  errorCode,
  isOutsideError,
  isPhoneSized,
  normalizeParticipants,
  retryLockMs,
  tryCommand,
  trySubscribe,
} from '@/lib/activitySdk';
import { watchFrameSize, watchKeyboard } from '@/lib/activityViewport';
import { ActivityContext } from '../ActivityContext';
import GalleryPage from '../GalleryPage';
import GameRoom from '../GameRoom';
import Header from '../Header';
import Icon from '../Icon';
import LeaderboardPage from '../LeaderboardPage';
import MemePage from '../MemePage';
import ProfilePage from '../ProfilePage';
import { useApp } from '../Providers';
import ActivityBoot from './ActivityBoot';
import ActivityOutside from './ActivityOutside';
import ActivityPeople from './ActivityPeople';
import ActivityPip from './ActivityPip';

const GAME = { name: 'game' };
// phases that need the player: switch back to the game when one starts
const ACTION_PHASES = new Set(['starting', 'upload', 'caption', 'vote']);
// Discord's language is taken over once per window, then the switch in the bar decides
const LOCALE_KEY = 'lt_activity_locale';
// the invite and share dialogs answer when the player is done with them
const DIALOG_TIMEOUT = 120_000;

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

/** Is the game waiting for this player right now? (shown on the small tile) */
function needsPlayer(state) {
  const me = state.players.find((p) => p.id === state.you);
  if (!me) return false;
  if (state.phase === 'caption') return Boolean(me.playing) && !me.submitted;
  if (state.phase === 'upload') return !me.submitted;
  if (state.phase === 'vote') return Boolean(state.vote) && !state.vote.isMine && state.vote.stage !== 'reveal' && state.vote.myScore === null;
  return false;
}

/** What the banner, the small tile and the Rich Presence need to know about the game. */
function summarize(state) {
  return {
    phase: state.phase,
    round: state.round,
    rounds: state.settings.rounds,
    game: state.settings.game,
    deadline: state.deadline || 0,
    // server clock minus ours, rounded so a few milliseconds do not count as a change
    offset: Math.round((state.serverNow - Date.now()) / 500) * 500,
    players: state.players.filter((p) => p.connected).length,
    maxPlayers: state.settings.maxPlayers,
    needsYou: needsPlayer(state),
  };
}

const sameInfo = (a, b) => Boolean(a && b) && Object.keys(b).every((k) => a[k] === b[k]);

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

/** A link Discord could not open: show the address, so it can be typed or copied. */
function LinkNotice({ url, onClose }) {
  const { t } = useApp();
  useEffect(() => {
    const id = setTimeout(onClose, 12_000);
    return () => clearTimeout(id);
  }, [url, onClose]);
  return (
    <div className="activity-notice" role="status">
      <p>
        {t('activity.link.failed')} <span className="activity-notice-url">{url}</span>
      </p>
      <button type="button" className="btn btn-small btn-white" onClick={onClose} aria-label={t('activity.link.dismiss')}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

/** The activity itself – only rendered inside Discord (see ../ActivityApp.jsx). */
export default function ActivityRoot() {
  const { t, lang, setLang, refreshAccount, setActivityMode } = useApp();
  const [phase, setPhase] = useState('boot'); // boot | room | error | outside
  const [step, setStep] = useState('connect'); // connect | login | room
  const [retry, setRetry] = useState(null);
  const [error, setError] = useState(null);
  const [retryAt, setRetryAt] = useState(0);
  const [code, setCode] = useState(null);
  const [roomKey, setRoomKey] = useState(0);
  // the connected SDK and what the login may do: { sdk, scope }
  const [discord, setDiscord] = useState(null);
  const [layout, setLayout] = useState(LAYOUT.FOCUSED);
  const [tiny, setTiny] = useState(false);
  const [people, setPeople] = useState([]);
  const [view, setView] = useState(GAME);
  const [gameInfo, setGameInfo] = useState(null);
  const [notice, setNotice] = useState(null);

  const shellRef = useRef(null);
  const sdkRef = useRef(null);
  const cfgRef = useRef(null);
  const cancelRef = useRef(null);
  const presenceRef = useRef(null);
  const keyboardResizesRef = useRef(false);
  const gameInfoRef = useRef(null);
  const historyRef = useRef([]);
  const rejoinRef = useRef(0);
  const viewRef = useRef(GAME);
  viewRef.current = view;
  const langRef = useRef(lang);
  langRef.current = lang;

  // the layout's header hides itself – this component shows the only one
  useLayoutEffect(() => {
    setActivityMode(true);
    // Inside Discord's frame the website header never comes back, even when
    // another screen takes over (the ban notice): its links would leave the frame.
    return () => {
      if (!isActivityUrl()) setActivityMode(false);
    };
  }, [setActivityMode]);

  // --- start-up ---------------------------------------------------------------------------

  const fail = useCallback((err) => {
    if (isOutsideError(err)) {
      setPhase('outside');
      return;
    }
    console.warn('[activity] start failed', err);
    const failed = errorCode(err);
    setError(failed);
    // no hammering: the button unlocks after a moment
    setRetryAt(Date.now() + retryLockMs(failed));
    setPhase('error');
  }, []);

  /** Runs the steps from `from` on; a newer run cancels the one before. */
  const start = useCallback(
    async (from = 'connect') => {
      cancelRef.current?.cancel();
      const cancel = createCancel();
      cancelRef.current = cancel;
      const alive = () => !cancel.cancelled;
      const onRetry = (info) => alive() && setRetry(info);
      const enter = (name) => {
        setStep(name);
        setRetry(null);
      };
      setError(null);
      setPhase('boot');
      try {
        let sdk = sdkRef.current;
        let cfg = cfgRef.current;
        let resumed = false;
        if (from === 'connect' || !sdk || !cfg) {
          enter('connect');
          ({ cfg, sdk } = await openConnection({ cancel, onRetry }));
          if (!alive()) return;
          cfgRef.current = cfg;
          sdkRef.current = sdk;
          from = 'login';
        }
        const doLogin = async () => {
          enter('login');
          const auth = await login({ sdk, cfg, cancel, onRetry, refreshAccount });
          if (alive()) setDiscord((cur) => (cur?.sdk === sdk && cur.scope === auth.scope ? cur : { sdk, scope: auth.scope }));
          return auth;
        };
        if (from === 'login') {
          ({ resumed } = await doLogin());
          if (!alive()) return;
        }
        enter('room');
        let room;
        try {
          room = await joinRoom({ sdk, cancel, onRetry });
        } catch (err) {
          // the kept login is not accepted any more: log in again, once
          if (errorCode(err) !== 'login_required' || !(resumed || from === 'room') || !alive()) throw err;
          forgetLogin();
          await doLogin();
          if (!alive()) return;
          enter('room');
          room = await joinRoom({ sdk, cancel, onRetry });
        }
        if (!alive()) return;
        setCode(room.code);
        setRoomKey((k) => k + 1);
        setPhase('room');
      } catch (err) {
        if (alive() && errorCode(err) !== 'cancelled') fail(err);
      }
    },
    [fail, refreshAccount],
  );

  useEffect(() => {
    start();
    return () => cancelRef.current?.cancel();
  }, [start]);

  // --- Discord client: language, layout, people in the call, orientation ----------------------

  const sdk = discord?.sdk || null;
  const mobile = sdk?.platform === 'mobile';

  useEffect(() => {
    if (!sdk) return undefined;
    let gone = false;
    const unsubscribe = [];
    const keep = (off) => (gone ? off() : unsubscribe.push(off));

    // Discord's language – once per window, afterwards the switch in the bar decides
    (async () => {
      try {
        if (sessionStorage.getItem(LOCALE_KEY)) return;
      } catch {
        /* storage blocked: ask every time */
      }
      const res = await tryCommand(sdk, 'userSettingsGetLocale');
      if (gone || !res.ok) return;
      const wanted = String(res.data?.locale || '').toLowerCase().startsWith('de') ? 'de' : 'en';
      if (wanted !== langRef.current) setLang(wanted, { refresh: false });
      try {
        sessionStorage.setItem(LOCALE_KEY, '1');
      } catch {
        /* ignore */
      }
    })();

    // focused, picture-in-picture or grid tile
    trySubscribe(sdk, 'ACTIVITY_LAYOUT_MODE_UPDATE', (data) => {
      const mode = Number(data?.layout_mode);
      setLayout(mode === LAYOUT.PIP || mode === LAYOUT.GRID ? mode : LAYOUT.FOCUSED);
    }).then(keep);

    // who of the call has the activity open (needs no extra permission)
    const showPeople = (data) => !gone && setPeople(normalizeParticipants(data?.participants));
    tryCommand(sdk, 'getActivityInstanceConnectedParticipants').then((res) => res.ok && showPeople(res.data));
    trySubscribe(sdk, 'ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', showPeople).then(keep);

    if (sdk.platform === 'mobile') {
      // A caption game needs the keyboard: on a phone that only works upright,
      // in landscape the keyboard would leave no room for the meme. Tablets
      // have enough room either way and stay free. The small tile is wide.
      if (isPhoneSized()) {
        tryCommand(sdk, 'setOrientationLockState', {
          lock_state: ORIENTATION_LOCK.PORTRAIT,
          picture_in_picture_lock_state: ORIENTATION_LOCK.LANDSCAPE,
          grid_lock_state: ORIENTATION_LOCK.UNLOCKED,
        });
      }
      tryCommand(sdk, 'getPlatformBehaviors').then((res) => {
        if (res.ok) keyboardResizesRef.current = res.data?.iosKeyboardResizesView === true;
      });
    }

    return () => {
      gone = true;
      for (const off of unsubscribe) off();
    };
  }, [sdk, setLang]);

  // tiny frame: old clients do not tell the layout mode
  useEffect(() => watchFrameSize(setTiny), []);

  // phones: keep the caption field above the on-screen keyboard
  useEffect(() => {
    if (!mobile || !shellRef.current) return undefined;
    return watchKeyboard(shellRef.current, { resizesView: () => keyboardResizesRef.current });
  }, [mobile]);

  // Rich Presence: Discord limits these updates, so they are throttled and never repeated
  useEffect(() => {
    if (!sdk || !canSetPresence(discord.scope)) return undefined;
    const throttle = createPresenceThrottle({
      send: async (activity) => {
        const res = await tryCommand(sdk, 'setActivity', { activity });
        if (!res.ok) throw new Error('presence not set');
      },
    });
    presenceRef.current = throttle;
    return () => {
      throttle.stop();
      if (presenceRef.current === throttle) presenceRef.current = null;
    };
  }, [sdk, discord?.scope]);

  // --- views ------------------------------------------------------------------------------

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
      const external = url.origin === window.location.origin ? new URL(url.pathname + url.search, base).toString() : url.toString();
      // an old Discord client cannot open links: show the address instead
      openExternal(external).then((opened) => !opened && setNotice(external));
      return undefined;
    },
    [go],
  );

  const closeNotice = useCallback(() => setNotice(null), []);

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

  const closeActivity = useCallback(() => {
    try {
      sdkRef.current?.close(1000, 'closed by player');
    } catch {
      /* ignore */
    }
  }, []);

  const ctx = useMemo(
    () => ({
      platform: sdk?.platform || 'desktop',
      /** Opens Discord's invite dialog; where that is not possible, the "share link" dialog. */
      async invite() {
        const client = sdkRef.current;
        const invited = await tryCommand(client, 'openInviteDialog', undefined, DIALOG_TIMEOUT);
        if (invited.ok || invited.code === 'timeout') return true;
        const shared = await tryCommand(client, 'shareLink', { message: t('activity.share.message') }, DIALOG_TIMEOUT);
        if (!shared.ok && shared.code !== 'timeout') console.warn('[activity] invite failed', invited.code, shared.code);
        return shared.ok || shared.code === 'timeout';
      },
      close: closeActivity,
      openExternal,
      navigate,
      publicUrl: cfgRef.current?.publicUrl || '',
      onState(state) {
        const prev = gameInfoRef.current;
        const info = summarize(state);
        if (!sameInfo(prev, info)) {
          gameInfoRef.current = info;
          setGameInfo(info);
          // a new phase that needs the player: back to the game
          if (prev && prev.phase !== info.phase && ACTION_PHASES.has(info.phase) && viewRef.current.name !== 'game') {
            historyRef.current = [];
            setView(GAME);
            window.scrollTo(0, 0);
          }
        }
        const client = sdkRef.current;
        if (!client || !presenceRef.current) return;
        const details =
          info.phase === 'lobby' || info.phase === 'starting'
            ? t('activity.presence.lobby')
            : info.phase === 'final'
              ? t('activity.presence.final')
              : t('activity.presence.round', { n: info.round, total: info.rounds });
        presenceRef.current.update({
          type: 0,
          details,
          state: t(`games.${info.game}`),
          party: { id: client.instanceId, size: [Math.max(1, info.players), info.maxPlayers] },
        });
      },
      onRoomGone() {
        // the room expired (everyone was away for a while): open a fresh one for this call
        if (Date.now() - rejoinRef.current < 5000) return;
        rejoinRef.current = Date.now();
        start('room');
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start, t, phase, navigate, sdk, closeActivity],
  );

  if (phase === 'outside') return <ActivityOutside />;

  const compact = layout === LAYOUT.PIP || tiny;
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

  const shellClass = [
    'activity-shell',
    compact ? 'is-compact is-pip' : '',
    mobile ? 'is-mobile' : 'is-desktop',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ActivityContext.Provider value={ctx}>
      <div className={shellClass} ref={shellRef}>
        {compact && <ActivityPip info={gameInfo} status={phase} people={people.length} />}
        {/* the game stays mounted behind the small tile: the connection and the round go on */}
        <div className="activity-full" hidden={compact}>
          <Header activityView={view.name} />
          <div className="activity-game" hidden={view.name !== 'game'}>
            <ActivityPeople people={people} />
            {phase === 'room' && code ? (
              <GameRoom key={`${code}-${roomKey}`} code={code} />
            ) : (
              <ActivityBoot
                step={step}
                retry={retry}
                error={phase === 'error' ? error : null}
                retryAt={retryAt}
                onRetry={() => start()}
                onClose={sdkRef.current ? closeActivity : null}
              />
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
        {notice && !compact && <LinkNotice url={notice} onClose={closeNotice} />}
      </div>
    </ActivityContext.Provider>
  );
}

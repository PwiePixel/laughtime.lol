'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { sanitizeName } from '@/lib/shared';
import { MASK, rememberRoom, syncRoomUrl } from '@/lib/streamer';
import { useGameSocket } from '@/lib/useGameSocket';
import { useActivity } from './ActivityContext';
import { BanNotice } from './SanctionGate';
import AvatarPicker from './AvatarPicker';
import CaptionPhase from './CaptionPhase';
import FinalPhase from './FinalPhase';
import Icon from './Icon';
import Lobby from './Lobby';
import UploadPhase from './UploadPhase';
import PlayerStrip from './PlayerStrip';
import { useApp } from './Providers';
import ScoresPhase from './ScoresPhase';
import VotePhase from './VotePhase';

function NameGate({ code, onDone }) {
  const { t, profile, updateProfile, streamerMode } = useApp();
  const [name, setName] = useState(profile?.name || '');
  const clean = sanitizeName(name);
  return (
    <div className="page-narrow">
      <form
        className="card join-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!clean) return;
          updateProfile({ name: clean });
          onDone();
        }}
      >
        <h1>{t('join.title', { code: streamerMode ? MASK : code })}</h1>
        <label className="label" htmlFor="gate-name">
          {t('home.nameLabel')}
        </label>
        <input
          id="gate-name"
          className="input"
          value={name}
          maxLength={20}
          autoFocus
          autoComplete="nickname"
          placeholder={t('home.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="label">{t('home.avatarLabel')}</span>
        <AvatarPicker value={profile.avatar} onChange={(avatar) => updateProfile({ avatar })} />
        <button className="btn btn-yellow btn-big btn-block" type="submit" disabled={!clean}>
          {t('join.button')}
        </button>
        <p className="center-text small join-login">
          {t('join.haveAccount')}{' '}
          <Link href={`/login?next=${encodeURIComponent(streamerMode ? '/room' : `/room/${code}`)}`}>{t('nav.login')}</Link>
        </p>
      </form>
    </div>
  );
}

function Fatal({ code: errCode, info }) {
  const { t } = useApp();
  const activity = useActivity();
  if (info && (errCode === 'banned' || errCode === 'restricted')) {
    return (
      <div className="page-narrow ban-page">
        {errCode === 'restricted' && <p className="lead center-text">{t('err.restricted_public')}</p>}
        <BanNotice sanction={info} />
      </div>
    );
  }
  return (
    <div className="page-narrow center">
      <div className="card">
        <div className="big-icon">
          <Icon name={errCode === 'kicked' || errCode === 'kicked_mod' ? 'hand' : 'error'} size={56} />
        </div>
        <p className="lead">{t(`err.${errCode}`)}</p>
        {activity ? (
          <button type="button" className="btn btn-yellow" onClick={() => activity.close()}>
            <Icon name="door" /> {t('activity.close')}
          </button>
        ) : (
          <Link href="/" className="btn btn-yellow">
            {t('common.backHome')}
          </Link>
        )}
      </div>
    </div>
  );
}

function Toast({ notice, minPlayers }) {
  const { t } = useApp();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!notice) return undefined;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(id);
  }, [notice]);
  if (!notice || !visible) return null;
  const key = `err.${notice.code}`;
  const text = t(key, { n: minPlayers });
  return (
    <div className="toast" role="status">
      {text === key ? t('err.bad_request') : text}
    </div>
  );
}

export default function GameRoom({ code }) {
  const { t, profile, accountLoading, streamerMode, updateProfile, setSanction, refreshAccount } = useApp();
  const activity = useActivity();
  const [ready, setReady] = useState(false);

  // streamer mode: keep the code out of the address bar (a reload of /room rejoins this room)
  useEffect(() => {
    if (activity) return; // Discord: the URL belongs to the activity
    rememberRoom(code);
    syncRoomUrl(code, streamerMode);
  }, [code, streamerMode, activity]);

  useEffect(() => {
    if (!accountLoading && profile?.name) setReady(true);
  }, [profile?.name, accountLoading]);

  const game = useGameSocket({ code, profile, enabled: ready });
  const { state, status, fatal, fatalInfo, notice, setNotice, send, onMessage } = game;

  // moderation messages
  useEffect(
    () =>
      onMessage((m) => {
        if (m.t === 'force_name') {
          if (!profile?.account) updateProfile({ name: m.name });
          else refreshAccount();
          setNotice({ code: 'name_reset', at: Date.now() });
        } else if (m.t === 'sanction') {
          setSanction(m.sanction);
        }
      }),
    [onMessage, profile?.account, updateProfile, refreshAccount, setNotice, setSanction],
  );
  useEffect(() => {
    if (fatal === 'banned' && fatalInfo) setSanction(fatalInfo);
  }, [fatal, fatalInfo, setSanction]);

  // Discord: report the game state (rich presence) and get a new room if this one expired
  useEffect(() => {
    if (activity && state) activity.onState(state);
  }, [activity, state]);
  useEffect(() => {
    if (activity && fatal === 'room_not_found') activity.onRoomGone();
  }, [activity, fatal]);

  // keep name/avatar changes in sync while connected
  useEffect(() => {
    if (ready && state && profile) {
      const me = state.players.find((p) => p.id === state.you);
      if (me && !profile.account && (me.avatar !== profile.avatar || (profile.name && me.name !== profile.name && !me.name.startsWith(`${profile.name} `)))) {
        send({ t: 'profile', name: profile.name, avatar: profile.avatar });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.name, profile?.avatar]);

  if (!profile || accountLoading) return <div className="page-center">{t('common.loading')}</div>;
  if (!ready) return <NameGate code={code} onDone={() => setReady(true)} />;
  if (fatal) return <Fatal code={fatal} info={fatalInfo} />;

  if (!state) {
    return (
      <div className="page-center">
        <div className="spinner" aria-hidden="true" />
        <p>{t('common.connecting')}</p>
      </div>
    );
  }

  const phaseView = (() => {
    switch (state.phase) {
      case 'upload':
        return <UploadPhase game={game} />;
      case 'caption':
        return <CaptionPhase game={game} />;
      case 'vote':
        return <VotePhase game={game} />;
      case 'scores':
        return <ScoresPhase game={game} />;
      case 'final':
        return <FinalPhase game={game} />;
      default:
        return <Lobby game={game} />;
    }
  })();

  return (
    <div className={`room phase-${state.phase}`}>
      {status !== 'open' && <div className="conn-banner">{t('common.reconnecting')}</div>}
      {state.phase !== 'lobby' && state.phase !== 'starting' && <PlayerStrip state={state} game={game} />}
      {phaseView}
      <Toast notice={notice} minPlayers={state.minPlayers} />
    </div>
  );
}

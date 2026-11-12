'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeName } from '@/lib/shared';
import AvatarPicker from './AvatarPicker';
import Icon from './Icon';
import MatchStage from './MatchStage';
import { useApp } from './Providers';

function NameStep({ game, onDone }) {
  const { t, profile, updateProfile } = useApp();
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
        <h1>{t('match.nameTitle')}</h1>
        <p className="muted with-icon left">
          <Icon name={game === 'hunt' ? 'search' : 'image'} size={18} /> {t('home.quick')} · {t(`games.${game}`)}
        </p>
        <label className="label" htmlFor="mm-name">
          {t('home.nameLabel')}
        </label>
        <input
          id="mm-name"
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
          <Icon name="globe" /> {t('match.go')}
        </button>
        <p className="center-text small join-login">
          {t('join.haveAccount')} <Link href={`/login?next=${encodeURIComponent(`/play?game=${game}`)}`}>{t('nav.login')}</Link>
        </p>
      </form>
    </div>
  );
}

export default function Matchmaking({ game }) {
  const router = useRouter();
  const { t, profile, account, accountLoading, setSanction } = useApp();
  const [named, setNamed] = useState(false);
  const [queue, setQueue] = useState(null);
  const [status, setStatus] = useState('connecting'); // connecting | searching | found | stopped
  const [problem, setProblem] = useState(null);
  const [, setTick] = useState(0);
  const wsRef = useRef(null);
  const offset = useRef(0);
  const stopped = useRef(false);

  useEffect(() => {
    if (!accountLoading && (account || profile?.name)) setNamed(true);
  }, [accountLoading, account, profile?.name]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const start = useCallback(() => {
    stopped.current = false;
    setProblem(null);
    setStatus('connecting');
    let retry = 0;
    let timer = null;
    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        ws.send(JSON.stringify({ t: 'queue', game, pid: profile.pid, name: profile.name, avatar: profile.avatar }));
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'queue') {
          offset.current = msg.serverNow - Date.now();
          setQueue(msg);
          setStatus('searching');
        } else if (msg.t === 'matched') {
          stopped.current = true;
          setStatus('found');
          ws.close();
          setTimeout(() => router.replace(`/room/${msg.code}`), 900);
        } else if (msg.t === 'error') {
          stopped.current = true;
          setStatus('stopped');
          setProblem(msg.code);
          if (msg.sanction) setSanction(msg.sanction);
          ws.close();
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped.current) return;
        setStatus('connecting');
        timer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [game, profile?.pid, profile?.name, profile?.avatar, router, setSanction]);

  useEffect(() => {
    if (!named || !profile?.pid) return undefined;
    return start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [named, profile?.pid, game]);

  function cancel() {
    stopped.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'unqueue' }));
    ws?.close();
    router.push('/');
  }

  if (!profile || accountLoading) return <div className="page-center">{t('common.loading')}</div>;
  if (!named) return <NameStep game={game} onDone={() => setNamed(true)} />;

  const serverNow = Date.now() + offset.current;
  const size = queue?.size || 0;
  const min = queue?.min || 4;
  const max = queue?.max || 8;
  const startsIn = queue?.startsAt ? Math.max(0, Math.ceil((queue.startsAt - serverNow) / 1000)) : 0;
  const relaxIn = queue?.relaxAt && !queue.startsAt && size < min ? Math.ceil((queue.relaxAt - serverNow) / 1000) : 0;
  const found = status === 'found';
  const players = (queue?.players || []).map((p, i) => ({ ...p, id: `${i}-${p.name}` }));

  let title = t('match.searching');
  if (found) title = t('match.found');
  else if (status === 'connecting') title = t('common.connecting');

  let note = null;
  if (problem) {
    const key = `err.${problem}`;
    note = t(key) === key ? t('err.bad_request') : t(key);
  } else if (relaxIn > 0 && size >= (queue?.relaxMin || 2)) {
    note = t('match.relax', { n: size, s: relaxIn });
  }

  return (
    <div className="page matchmaking-page">
      <MatchStage
        title={title}
        game={game}
        players={players}
        slots={found ? 0 : Math.max(min, Math.min(max, size + 1))}
        progress={found ? 1 : size / min}
        countText={size >= min ? t('match.countMax', { n: size, max }) : t('match.count', { n: size, min })}
        startsIn={startsIn > 0 && !found ? t('match.startsIn', { n: startsIn }) : null}
        note={note}
        found={found}
      >
        <div className="mm-actions">
          {status === 'stopped' ? (
            <button type="button" className="btn btn-yellow" onClick={() => start()}>
              <Icon name="repeat" /> {t('match.retry')}
            </button>
          ) : null}
          {!found && (
            <button type="button" className="btn btn-white" onClick={cancel}>
              <Icon name="x" /> {t('match.cancel')}
            </button>
          )}
        </div>
        {queue?.online > 0 && <p className="mm-online">{t('match.online', { n: queue.online })}</p>}
      </MatchStage>
    </div>
  );
}

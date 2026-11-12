'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { wsProtocols } from './activity';

const FATAL = new Set(['room_not_found', 'room_full', 'kicked', 'bad_request', 'already_in_room', 'banned', 'restricted', 'kicked_mod']);

/**
 * WebSocket connection to the game server with automatic reconnect.
 * Returns the personalised room state and a send() function.
 */
export function useGameSocket({ code, profile, enabled }) {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [fatal, setFatal] = useState(null);
  const [fatalInfo, setFatalInfo] = useState(null);
  const errorListeners = useRef(new Set());
  const [notice, setNotice] = useState(null);
  const wsRef = useRef(null);
  const offsetRef = useRef(0);
  const profileRef = useRef(profile);
  const reactListeners = useRef(new Set());
  const messageListeners = useRef(new Set());

  profileRef.current = profile;

  useEffect(() => {
    if (!enabled || !profile?.pid) return undefined;
    let stopped = false;
    let retry = 0;
    let timer = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`, wsProtocols());
      wsRef.current = ws;
      setStatus((s) => (s === 'open' ? 'reconnecting' : s));

      ws.onopen = () => {
        retry = 0;
        const p = profileRef.current;
        ws.send(JSON.stringify({ t: 'hello', code, pid: p.pid, secret: p.secret, name: p.name, avatar: p.avatar }));
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'state') {
          offsetRef.current = msg.state.serverNow - Date.now();
          setState(msg.state);
          setStatus('open');
        } else if (msg.t === 'error') {
          if (FATAL.has(msg.code)) {
            stopped = true;
            setFatalInfo(msg.sanction || null);
            setFatal(msg.code);
            ws.close();
          } else {
            errorListeners.current.forEach((fn) => fn(msg.code));
            setNotice({ code: msg.code, at: Date.now() });
          }
        } else if (msg.t === 'kicked') {
          stopped = true;
          setFatal('kicked');
          ws.close();
        } else if (msg.t === 'react') {
          reactListeners.current.forEach((fn) => fn(msg));
        } else {
          messageListeners.current.forEach((fn) => fn(msg));
        }
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (stopped) return;
        setStatus('reconnecting');
        timer = setTimeout(connect, Math.min(8000, 400 * 2 ** retry++));
      };
      ws.onerror = () => ws.close();
    };

    connect();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !wsRef.current && !stopped) {
        clearTimeout(timer);
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, code, profile?.pid]);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  const onReact = useCallback((fn) => {
    reactListeners.current.add(fn);
    return () => reactListeners.current.delete(fn);
  }, []);

  /** other server messages (e.g. swap_results) */
  const onMessage = useCallback((fn) => {
    messageListeners.current.add(fn);
    return () => messageListeners.current.delete(fn);
  }, []);

  const onError = useCallback((fn) => {
    errorListeners.current.add(fn);
    return () => errorListeners.current.delete(fn);
  }, []);

  return { state, status, fatal, fatalInfo, notice, setNotice, send, serverNow, onReact, onMessage, onError };
}

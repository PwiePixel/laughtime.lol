'use client';

/**
 * Verbindung zum Spielserver (/geotime-ws).
 *
 * Hält die Verbindung offen, verbindet nach einem Abriss neu und sammelt die
 * Zustände, die die Oberfläche braucht. Hot-Updates am Server merkt der Spieler
 * nicht – die Verbindung bleibt dabei bestehen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const WS_URL = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/geotime-ws`;

/**
 * Wer gerade in welchem Raum ist, steht im Tab (sessionStorage). Reißt die
 * Verbindung ab – WLAN-Wechsel, Tunnel, Neuladen –, geht es damit zurück in
 * die laufende Runde, statt vor einem leeren Bild zu stehen.
 */
const SEAT_KEY = 'geotime-seat';
const seat = {
  read() {
    try {
      const raw = sessionStorage.getItem(SEAT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  write(value) {
    try {
      if (value) sessionStorage.setItem(SEAT_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(SEAT_KEY);
    } catch {
      /* privates Fenster */
    }
  },
};

export function useGeoSocket() {
  const ws = useRef(null);
  const queue = useRef([]);
  const retry = useRef(0);
  const [connected, setConnected] = useState(false);
  const [you, setYou] = useState(null);
  const [room, setRoom] = useState(null);
  const [round, setRound] = useState(null);
  const [result, setResult] = useState(null);
  const [tribunal, setTribunal] = useState(null);
  const [final, setFinal] = useState(null);
  const [heat, setHeat] = useState(null); // GeoHunt: warm/kalt + Richtung
  const [found, setFound] = useState(null); // GeoHunt: angekommen
  const [spot, setSpot] = useState(null); // Geo Star: eigener Ort
  const [spotResult, setSpotResult] = useState(null);
  const [error, setError] = useState('');

  const send = useCallback((msg) => {
    const payload = JSON.stringify(msg);
    if (ws.current?.readyState === 1) ws.current.send(payload);
    else queue.current.push(payload);
  }, []);

  useEffect(() => {
    let dead = false;
    let timer = null;

    const open = () => {
      if (dead) return;
      const socket = new WebSocket(WS_URL());
      ws.current = socket;

      socket.onopen = () => {
        retry.current = 0;
        setConnected(true);
        // zuerst zurück auf den alten Platz, dann erst alles Wartende
        const back = seat.read();
        if (back?.code && back?.id && back?.token) {
          socket.send(JSON.stringify({ t: 'rejoin', code: back.code, id: back.id, token: back.token }));
        }
        queue.current.splice(0).forEach((m) => socket.send(m));
      };

      socket.onclose = () => {
        setConnected(false);
        if (dead) return;
        retry.current = Math.min(retry.current + 1, 6);
        timer = setTimeout(open, 500 * retry.current);
      };

      socket.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (msg.t) {
          case 'joined':
            setYou(msg.you);
            setRoom(msg.room);
            setError('');
            // Platz merken – damit geht es nach einem Abriss wieder zurück.
            // Der Zettel kommt getrennt vom Raum, weil ein Solo-Raum nach
            // außen keinen Code hat.
            seat.write(msg.seat?.code && msg.seat?.token ? msg.seat : null);
            break;
          case 'room':
            setRoom(msg.room);
            break;
          case 'round':
            setRound(msg.round);
            setResult(null);
            setTribunal(null);
            setFinal(null);
            setHeat(null);
            setFound(null);
            setError('');
            break;
          case 'heat':
            setHeat({ ...msg, at: Date.now() });
            break;
          case 'found':
            setFound(msg.found);
            setHeat({ heat: 'found', at: Date.now() });
            break;
          case 'spot':
            setSpot(msg.spot);
            setSpotResult(null);
            setFinal(null);
            setError('');
            break;
          case 'spotResult':
            setSpotResult(msg.result);
            break;
          case 'board':
            setRound((r) => (r ? { ...r, board: msg.board } : r));
            break;
          case 'tribunal':
            setTribunal({ endsAt: msg.endsAt, items: msg.items });
            break;
          case 'result':
            setResult(msg.result);
            setTribunal(null);
            break;
          case 'final':
            // `star` ist nur bei Geo Star dabei: der Spieler mit den meisten Punkten
            setFinal({ scores: msg.scores, rounds: msg.rounds, star: msg.star || null });
            break;
          case 'left':
            seat.write(null);
            setRoom(null);
            setYou(null);
            setRound(null);
            setResult(null);
            setFinal(null);
            break;
          case 'error':
            // Rückkehr hat nicht geklappt (Raum ist weg)? Dann den Platz
            // vergessen und still weitermachen – der Spieler wählt neu.
            if (msg.code === 'rejoin_failed' || msg.code === 'room_not_found') {
              seat.write(null);
              if (msg.code === 'rejoin_failed') break;
            }
            setError(msg.detail || msg.code || 'Fehler');
            break;
          default:
            break;
        }
      };
    };

    open();
    return () => {
      dead = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, []);

  return {
    connected,
    you,
    room,
    round,
    result,
    tribunal,
    final,
    heat,
    found,
    spot,
    spotResult,
    error,
    setError,
    send,
  };
}

'use client';

/**
 * GeoTime – das Spiel.
 *
 * Fünf Spielarten im selben Gerüst:
 *   Klassisch  – Straßenansicht angucken, auf der Karte tippen, Punkte nach
 *                Entfernung. Allein oder zusammen im Raum.
 *   Bingo      – Begriffe im Bild finden und abhaken, am Rundenende das Tribunal.
 *   GeoHunt    – Zielfoto ansehen und durch die Straßenansicht dorthin laufen.
 *   Deathmatch – jede Runde fliegt der schlechteste Tipp raus.
 *   Geo Star   – feste Zeit, so viele Orte wie möglich; die meisten Punkte
 *                machen zum Geo Star.
 *
 * Der Server schickt nie die echte Position der laufenden Runde – die kommt
 * erst mit der Auswertung. Deshalb steht hier auch nirgends ein `truth`, bevor
 * `result` da ist.
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import GeoLogo from './GeoLogo';
import BingoBoard from './BingoBoard';
import GeoLobby from './GeoLobby';
import HuntPanel from './HuntPanel';
import Tribunal from './Tribunal';
import { confidenceFor } from './detect';
import { distanceText } from '@/lib/geotime/format';
import { useGeo } from './GeoProviders';
import { useGeoSocket } from './useGeoSocket';

// beide sind groß – erst laden, wenn sie gebraucht werden
const Pano = dynamic(() => import('./Pano'), { ssr: false });
// Panoramax braucht einen anderen Viewer als Mapillary – geladen wird nur der,
// der auch gebraucht wird
const PanoPsv = dynamic(() => import('./PanoPsv'), { ssr: false });
const GuessMap = dynamic(() => import('./GuessMap'), { ssr: false });

const NAME_KEY = 'geotime-name';
const AVATAR_KEY = 'geotime-avatar';
/** Reihenfolge der Spielarten, falls der Server gerade nichts sagt */
const GAMES = ['classic', 'bingo', 'hunt', 'deathmatch', 'star'];
/** Diese beiden kann man auch allein spielen, die anderen brauchen einen Raum */
const SOLO_GAMES = ['classic', 'star'];
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const phaseOf = (room) => room?.phase || 'setup';



export default function PlayClient() {
  const { t, lang } = useGeo();
  const params = useSearchParams();
  const router = useRouter();
  // Von der Startseite kommt die Wahl schon mit: ?game=… , ?code=XXXXX und
  // ?room=1 (aus „Privates Spiel": dann immer ein Raum mit Code)
  const wanted = params.get('game');
  const wantedCode = params.get('code');
  const wantRoom = params.get('room') === '1';
  const [config, setConfig] = useState(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [game, setGame] = useState('classic');
  const [mode, setMode] = useState('2v2');
  const [pick, setPick] = useState(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [busyCell, setBusyCell] = useState(null);
  const [note, setNote] = useState('');
  const view = useRef({});

  const { connected, you, room, round, result, tribunal, final, heat, found, spot, spotResult, error, setError, send } =
    useGeoSocket();

  useEffect(() => {
    fetch('/geotime-api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig({ pano: { ready: false } }));
    try {
      setName(localStorage.getItem(NAME_KEY) || '');
      setAvatar(localStorage.getItem(AVATAR_KEY) || '');
    } catch {
      /* privates Fenster */
    }
  }, []);

  // Ohne Wahl auf /play? Dann zurück zur Startseite – dort wird gewählt.
  useEffect(() => {
    if (room || wanted || wantedCode) return;
    router.replace('/');
  }, [room, wanted, wantedCode, router]);

  // Läuft die Runde, fehlt aber das Bild? Dann ist unterwegs etwas verloren
  // gegangen – einmal nachfragen statt ewig „lädt…" anzuzeigen.
  useEffect(() => {
    const running = room?.phase === 'playing';
    const haveShot = room?.game === 'star' ? Boolean(spot?.image?.id) : Boolean(round?.image?.id);
    if (!running || haveShot || !connected) return undefined;
    const id = setInterval(() => send({ t: 'sync' }), 4000);
    return () => clearInterval(id);
  }, [room?.phase, room?.game, round?.image?.id, spot?.image?.id, connected, send]);

  // Den Viewer schon laden, während man noch in der Lobby steht – dann steht
  // die Straßenansicht sofort, wenn die Runde losgeht (die Pakete sind groß).
  useEffect(() => {
    if (!config?.pano?.provider) return;
    if (config.pano.provider === 'panoramax') import('./PanoPsv').catch(() => {});
    else if (config.pano.provider === 'mapillary') import('./Pano').catch(() => {});
    import('./GuessMap').catch(() => {});
  }, [config?.pano?.provider]);

  // Laufende Runde = Vollbild: Kopf- und Fußzeile gehen aus
  const inRound = phaseOf(room) === 'playing' || phaseOf(room) === 'tribunal';
  useEffect(() => {
    document.body.classList.toggle('geo-in-round', inRound);
    return () => document.body.classList.remove('geo-in-round');
  }, [inRound]);

  // Uhr für die Restzeit
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const endsAt = tribunal?.endsAt || round?.endsAt || room?.endsAt || null;
  const left = endsAt ? Math.max(0, Math.round((endsAt - now) / 1000)) : null;
  const phase = room?.phase || 'setup';
  const isHost = room && you && room.hostId === you.id;
  const me = useMemo(() => room?.players.find((p) => p.id === you?.id) || null, [room, you]);
  const myTeam = me?.team || 'a';
  // Geo Star hat eigene Orte je Spieler, GeoHunt startet woanders als das Ziel
  const activeShot = room?.game === 'star' ? spot?.image : round?.image;
  const activeImage = activeShot?.id;
  // Welcher Viewer? Normalerweise die eingestellte Quelle – aber eine einzelne
  // Runde kann auch von woanders kommen (Ausweichquelle, wenn eine hakt).
  const shotSource = activeShot?.source || config?.pano?.provider;

  /** Raum verlassen und zurück auf die Startseite – nichts bleibt hängen */
  const leaveRoom = () => {
    send({ t: 'leave' });
    router.push('/');
  };

  // Name und Bildchen kommen von der Startseite (beides steht im Browser)
  // Name und Bildchen kommen von der Startseite (beides steht im Browser)
  const player = () => ({ name: name.trim() || 'Spieler', avatar: avatar || undefined });


  const submitGuess = () => {
    if (!pick) return;
    send({ t: 'guess', lat: pick.lat, lng: pick.lng });
    setMapOpen(false);
    setPick(null);
  };

  // Bingo: Feld abhaken – der Schnappschuss bleibt auf dem Gerät
  const claim = useCallback(
    async (cell) => {
      // Achtung: 0 ist eine gültige Koordinate – deshalb auf "ist eine Zahl"
      // prüfen. Bei Panoramax kommen gar keine Koordinaten im Browser an; dann
      // reicht die Bild-ID, der Server schlägt die Position selbst nach.
      const haveSpot =
        (Number.isFinite(view.current?.lat) && Number.isFinite(view.current?.lng)) ||
        Boolean(view.current?.imageId);
      if (!haveSpot) {
        setNote(t('play.loadView'));
        return;
      }
      setBusyCell(cell.i);
      setNote('');
      let confidence = 0.5;
      try {
        const canvas = document.querySelector('.geo-pano-host canvas');
        confidence = await confidenceFor(canvas, cell.term);
      } catch {
        confidence = 0.5;
      }
      if (confidence < 0.3) {
        setNote(t('play.notHere', { term: cell.term }));
        setBusyCell(null);
        return;
      }
      send({
        t: 'claim',
        cell: cell.i,
        confidence,
        lat: view.current.lat,
        lng: view.current.lng,
        heading: view.current.heading,
        pitch: view.current.pitch,
        zoom: view.current.zoom,
        imageId: view.current.imageId,
      });
      setBusyCell(null);
    },
    [send],
  );

  useEffect(() => {
    if (round) setPick(null);
  }, [round]);

  useEffect(() => {
    if (spot) setPick(null);
  }, [spot]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current || !connected || room || !config?.pano?.ready) return;
    if (wantedCode) {
      started.current = true;
      send({ t: 'join', code: wantedCode.toUpperCase(), player: player() });
      return;
    }
    // Klassisch und Geo Star gehen allein sofort los, die anderen über einen Raum
    if (GAMES.includes(wanted)) {
      started.current = true;
      setGame(wanted);
      const alone = !wantRoom && SOLO_GAMES.includes(wanted);
      send({ t: alone ? 'solo' : 'create', game: wanted, mode, player: player() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, room, config, wanted, wantedCode, wantRoom]);

  // --- Ohne Raum: hier gibt es nichts zu sehen ------------------------------
  // Gewählt wird auf der Startseite (Name, Bildchen, schnell oder privat,
  // dann die Spielart). /play ist nur die Runde selbst – wer ohne Wahl
  // hierherkommt, wird zurückgeschickt.
  if (!room) {
    if (!wanted && !wantedCode) {
      return (
        <div className="geo-screen geo-waiting">
          <GeoLogo className="hero-logo geo-logo-small" />
          <p className="waiting">
            <span className="spinner small" aria-hidden="true" />
            {t('play.connecting')}
          </p>
        </div>
      );
    }
    return (
      <div className="geo-screen geo-waiting">
        <GeoLogo className="hero-logo geo-logo-small" />
        {!config?.pano?.ready && config && <p className="form-error">{t('play.noToken')}</p>}
        {error ? (
          <>
            <p className="form-error">{error}</p>
            <div className="geo-actions">
              <Link href="/" className="btn btn-yellow">
                {t('play.back')}
              </Link>
            </div>
          </>
        ) : (
          <p className="waiting">
            <span className="spinner small" aria-hidden="true" />
            {wantedCode ? t('play.joining') : t('play.opening')}
          </p>
        )}
      </div>
    );
  }

  // --- Lobby ----------------------------------------------------------------
  if (phase === 'lobby') {
    return (
      <div className="geo-screen">
        {error && <p className="form-error">{error}</p>}
        <GeoLobby
          room={room}
          you={you}
          isHost={isHost}
          onStart={() => send({ t: 'start' })}
          onLeave={leaveRoom}
          onSettings={(patch) => send({ t: 'settings', ...patch })}
          onTeam={(team) => send({ t: 'team', team })}
        />
      </div>
    );
  }

  // --- Auswertung / Ende ----------------------------------------------------
  // Jede Spielart zeigt hier etwas anderes: Klassisch und Deathmatch die
  // Karte mit allen Tipps, GeoHunt die Ankunftszeiten, Bingo den Teamstand
  // und Geo Star nur den Endstand (dort gibt es keine Runden).
  if ((phase === 'result' || phase === 'final') && (result || final)) {
    const isEnd = phase === 'final' && Boolean(final);
    const kind = result?.game || room?.game || 'classic';
    const title = isEnd
      ? kind === 'star'
        ? t('star.title')
        : t('play.finalTitle')
      : t('play.resultTitle', { n: result?.n, total: result?.total });

    return (
      <div className="geo-screen">
        <h1>{title}</h1>

        {result && kind === 'bingo' && (
          <>
            <ul className="geo-list">
              {['a', 'b'].map((team) => (
                <li key={team} className={`card geo-row t-${team}`}>
                  <strong>Team {team.toUpperCase()}</strong>
                  <span>
                    {result.scores?.[team]?.cells ?? 0} Felder · {result.scores?.[team]?.lines ?? 0} Reihen
                  </span>
                  <span className="geo-points">{result.scores?.[team]?.points ?? 0} P</span>
                </li>
              ))}
            </ul>
            {result.decided?.length > 0 && (
              <ul className="geo-decided">
                {result.decided.map((d) => (
                  <li key={d.cell}>
                    {d.accepted ? '✓' : '✕'} {d.term} ({d.real} echt / {d.fake} erfunden)
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {result && kind === 'hunt' && (
          <>
            <GuessMap style={config?.map?.style} result={result} className="geo-map-result" />
            <p className="muted">
              {t('play.was')} <strong>{result.area}</strong>
            </p>
            <ul className="geo-list">
              {(result.rows || []).map((r) => (
                <li key={r.playerId} className="card geo-row">
                  <strong>{r.name}</strong>
                  <span>
                    {r.found ? t('hunt.seconds', { n: r.seconds }) : distanceText(r.km, lang)}
                  </span>
                  <span className="geo-points">{r.points} P</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {result && (kind === 'classic' || kind === 'deathmatch') && (
          <>
            <GuessMap style={config?.map?.style} result={result} className="geo-map-result" />
            <p className="muted">
              {t('play.was')} <strong>{result.area}</strong>
            </p>
            <ul className="geo-list">
              {(result.guesses || []).map((g) => (
                <li
                  key={g.playerId}
                  className={`card geo-row ${result.eliminated?.playerId === g.playerId ? 'is-out' : ''}`}
                >
                  <strong>{g.name}</strong>
                  <span>{g.skipped ? t('play.noGuess') : distanceText(g.km, lang)}</span>
                  <span className="geo-points">{g.points} P</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {result?.eliminated && (
          <p className="geo-knock">
            <Icon name="x" size={18} />
            {t('dm.eliminated', { name: result.eliminated.name })}
          </p>
        )}
        {kind === 'deathmatch' && !isEnd && me?.out && <p className="muted">{t('dm.youOut')}</p>}

        {isEnd && (
          <>
            {kind === 'star' && final.star && <p className="geo-crown">{t('star.winner', { name: final.star.name })}</p>}
            {kind === 'deathmatch' && final.scores?.[0] && (
              <p className="geo-crown">{t('dm.winner', { name: final.scores[0].name })}</p>
            )}
            <ul className="geo-list">
              {final.scores.map((s, i) => (
                <li key={s.id} className="card geo-row">
                  <strong>
                    {i + 1}. {s.name}
                  </strong>
                  {kind === 'star' && <span>{s.spots === 1 ? t('star.spot1') : t('star.spots', { n: s.spots ?? 0 })}</span>}
                  <span className="geo-points">{s.points} P</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="geo-actions">
          {isHost && (
            <button
              type="button"
              className="btn btn-yellow"
              onClick={() => {
                // Am Ende geht es zurück in die Lobby (da kann man die
                // Spielart ändern und auf Mitspieler warten). Allein braucht
                // es das nicht – da startet gleich die nächste Runde.
                if (isEnd && !room.solo) return send({ t: 'again' });
                return send({ t: 'start' });
              }}
            >
              {isEnd ? t('play.again') : t('play.next')}
            </button>
          )}
          <button type="button" className="btn btn-small btn-ghost" onClick={leaveRoom}>
            {t('play.back')}
          </button>
        </div>
      </div>
    );
  }

  // --- Tribunal -------------------------------------------------------------
  if (phase === 'tribunal' && tribunal) {
    return (
      <div className="geo-screen">
        <Tribunal
          items={tribunal.items}
          myTeam={myTeam}
          endsIn={left}
          onVote={(snapId, real) => send({ t: 'vote', snapId, real })}
          t={t}
        />
        <div className="geo-actions">
          <button type="button" className="btn btn-yellow" onClick={() => send({ t: 'done' })}>
            {t('play.done')}
          </button>
        </div>
      </div>
    );
  }

  // --- Laufende Runde -------------------------------------------------------
  return (
    // bei GeoHunt liegt unten der Zielfoto-Kasten – die Schritte zum
    // Weiterlaufen müssen dann woanders hin
    <div className={`geo-play ${room.game === 'hunt' ? 'is-hunt' : ''}`}>
      {shotSource === 'panoramax' ? (
        <PanoPsv
          imageId={activeImage}
          onView={(v) => {
            view.current = v;
            // GeoHunt: der Server schlägt die Position zur Bild-ID selbst nach
            // und sagt nur, wie warm es wird
            if (room.game === 'hunt' && v.imageId) send({ t: 'move', imageId: v.imageId });
          }}
        />
      ) : (
        <Pano
          imageId={activeImage}
          token={config?.pano?.token}
          provider={config?.pano?.provider}
          onView={(v) => {
            view.current = v;
            // GeoHunt: der Server sagt daraufhin nur, wie warm es wird
            if (room.game === 'hunt' && Number.isFinite(v.lat)) send({ t: 'move', lat: v.lat, lng: v.lng });
          }}
        />
      )}

      <div className="geo-hud">
        {room.game === 'star' ? (
          <span className="chip">{t('star.spot', { n: spot?.n || 1 })}</span>
        ) : (
          <span className="chip">{t('play.round', { n: room.round, total: room.rounds })}</span>
        )}
        {left !== null && <span className={`chip ${left <= 15 ? 't-warn' : ''}`}>{fmt(left)}</span>}
        {room.game === 'bingo' && <span className={`chip t-${myTeam}`}>Team {myTeam.toUpperCase()}</span>}
        {room.game === 'star' && <span className="chip t-a">{t('star.points', { n: me?.points ?? 0 })}</span>}
        {room.game === 'deathmatch' && (
          <span className="chip">{t('dm.left', { n: room.players.filter((p) => !p.out).length })}</span>
        )}
      </div>

      {note && <p className="geo-note">{note}</p>}
      {error && <p className="geo-note geo-note-bad">{error}</p>}

      {room.game === 'hunt' ? (
        <HuntPanel
          target={round?.target}
          token={config?.pano?.token}
          provider={config?.pano?.provider}
          heat={heat}
          found={found}
          busy={Boolean(found)}
          t={t}
          onArrive={() => {
            // Mapillary: der Viewer kennt die Koordinaten. Panoramax: nur die
            // Bild-ID, den Rest schlägt der Server nach.
            if (Number.isFinite(view.current?.lat)) {
              return send({ t: 'arrive', lat: view.current.lat, lng: view.current.lng });
            }
            if (view.current?.imageId) return send({ t: 'arrive', imageId: view.current.imageId });
            return setNote(t('play.loadView'));
          }}
        />
      ) : room.game === 'bingo' ? (
        <>
          <BingoBoard
            board={round?.board || room?.board}
            myTeam={myTeam}
            onClaim={claim}
            busyCell={busyCell}
            onDone={() => send({ t: 'done' })}
            t={t}
          />
        </>
      ) : (
        <>
          <div className={`geo-guess ${mapOpen ? 'open' : ''}`}>
            <GuessMap style={config?.map?.style} pick={pick} onPick={setPick} />
            <div className="geo-guess-bar">
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setMapOpen((o) => !o)}>
                {mapOpen ? t('play.smaller') : t('play.bigger')}
              </button>
              <button type="button" className="btn btn-yellow" disabled={!pick || me?.out} onClick={submitGuess}>
                {t('play.submit')}
              </button>
            </div>
          </div>
          {me?.out && <p className="geo-note geo-note-bad">{t('dm.youOut')}</p>}
          {!me?.out && me?.ready && room.game !== 'star' && <p className="geo-note">{t('play.waiting')}</p>}
          {room.game === 'star' && spotResult && (
            <p className="geo-note">
              {distanceText(spotResult.km, lang)} · +{spotResult.points}
            </p>
          )}
        </>
      )}
    </div>
  );
}

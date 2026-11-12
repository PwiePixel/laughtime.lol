'use client';

/**
 * GeoTime – Betriebsansicht (nur mit Token).
 *
 * Zeigt die laufenden Instanzen, ihre Ports und den Stand der Hot-Updates.
 * Auf der öffentlichen Seite steht davon nichts: die API gibt diese Angaben
 * nur mit dem Token aus GEOTIME_ADMIN_TOKEN heraus, und der Token liegt nur
 * im Speicher dieses Tabs (sessionStorage), nie in einem Cookie.
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'geotime-admin-token';

const readToken = () => {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
};

const fmtUptime = (ms) => {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
};

export default function AdminPanel() {
  const [token, setToken] = useState('');
  const [input, setInput] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setToken(readToken()), []);

  const load = useCallback(
    async (t = token) => {
      if (!t) return;
      try {
        const res = await fetch('/geotime-api/instances', { headers: { Authorization: `Bearer ${t}` } });
        if (res.status === 401) {
          setError('Token stimmt nicht.');
          setData(null);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        setData(await res.json());
        setError('');
      } catch {
        setError('Server nicht erreichbar.');
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token) return undefined;
    load(token);
    const id = setInterval(() => load(token), 5000);
    return () => clearInterval(id);
  }, [token, load]);

  const save = (e) => {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    try {
      sessionStorage.setItem(KEY, t);
    } catch {
      /* privates Fenster: dann gilt der Token nur für diese Seite */
    }
    setToken(t);
    setInput('');
  };

  const forget = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* egal */
    }
    setToken('');
    setData(null);
    setError('');
  };

  const act = async (body) => {
    setBusy(true);
    try {
      const res = await fetch('/geotime-api/instances', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) setError(out.error || 'Hat nicht geklappt.');
      else setError('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="geo-stack">
        <h1>Betrieb</h1>
        <form onSubmit={save} className="card geo-narrow">
          <label htmlFor="geo-token" className="label">
            Token aus GEOTIME_ADMIN_TOKEN
          </label>
          <input
            id="geo-token"
            type="password"
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-yellow">
            Anmelden
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="row-end">
        <h1>Betrieb</h1>
        <button type="button" className="btn btn-small btn-ghost" onClick={forget}>
          Abmelden
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {!data && !error && <p className="muted">Lade…</p>}

      {data?.instances?.map((i) => (
        <section key={i.id} className="card">
          <div className="chips">
            <span className={`chip ${i.channel === 'beta' ? 't-warn' : 't-a'}`}>{i.id}</span>
            <span className="chip">{i.channel}</span>
            <span className="chip">Port {i.port}</span>
            <span className="chip">{i.players} verbunden</span>
            <span className="chip">seit {fmtUptime(i.uptimeMs)}</span>
          </div>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Hot-Updates: {i.hot?.applied || 0} übernommen
            {i.hot?.lastApplied ? ` · zuletzt ${new Date(i.hot.lastApplied).toLocaleTimeString('de-DE')}` : ' · noch keins'}
            {i.hot?.modules ? ` · ${i.hot.modules} Module` : ''}
            {i.hot?.lastError ? ' · FEHLER' : ''}
          </p>
          {i.channel === 'beta' && (
            <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => act({ action: 'stop', id: i.id })}>
              Beta stoppen
            </button>
          )}
        </section>
      ))}

      <button type="button" className="btn btn-yellow" disabled={busy} onClick={() => act({ by: 'admin' })}>
        Neue Beta-Instanz starten
      </button>
    </>
  );
}

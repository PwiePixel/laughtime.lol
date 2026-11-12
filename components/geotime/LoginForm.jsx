'use client';

/**
 * Anmelden oder Konto anlegen – eigene Konten von GeoTime, aber dieselben
 * Bausteine wie bei LaughTime (.card, .label, .input, .btn, .form-error).
 * Ohne Konto kann man weiterhin spielen, nur zählt dann nichts für die
 * Bestenliste.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useGeo } from './GeoProviders';

const MESSAGES = {
  wrong_login: 'auth.wrong',
  name_taken: 'auth.taken',
  weak_password: 'auth.weak',
  bad_username: 'auth.badName',
  too_many: 'auth.tooMany',
};

export default function LoginForm() {
  const { t, setAccount, refreshAccount } = useGeo();
  const router = useRouter();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/geotime-api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t(MESSAGES[data.error] || 'auth.failed'));
        return;
      }
      setAccount({ ...data.player, stats: data.stats });
      await refreshAccount();
      router.push('/');
    } catch {
      setError(t('auth.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="geo-stack">
      <h1>{t(mode === 'login' ? 'auth.title' : 'auth.registerTitle')}</h1>
      <p className="muted geo-narrow">{t('auth.why')}</p>
      <form className="card geo-narrow" onSubmit={submit}>
        {error && <p className="form-error">{error}</p>}
        <label className="label" htmlFor="geo-user">
          {t('auth.username')}
        </label>
        <input
          id="geo-user"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          maxLength={20}
          required
        />
        <label className="label" htmlFor="geo-pass">
          {t('auth.password')}
        </label>
        <input
          id="geo-pass"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          required
        />
        <button type="submit" className="btn btn-yellow btn-block top-gap" disabled={busy}>
          {t(mode === 'login' ? 'auth.login' : 'auth.register')}
        </button>
      </form>
      <button
        type="button"
        className="btn btn-small btn-ghost"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError('');
        }}
      >
        {t(mode === 'login' ? 'auth.toRegister' : 'auth.toLogin')}
      </button>
    </div>
  );
}

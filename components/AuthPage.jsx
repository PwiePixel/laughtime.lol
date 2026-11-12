'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import AvatarPicker from './AvatarPicker';
import Icon from './Icon';
import { useApp } from './Providers';

const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

export default function AuthPage() {
  const { t, account, accountLoading, setAccount, discordEnabled, profile } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState(params.get('mode') === 'register' ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [avatar, setAvatar] = useState('');
  const [error, setError] = useState(params.get('error') || '');
  const [busy, setBusy] = useState(false);
  const [nameFree, setNameFree] = useState(null);
  const [showPass, setShowPass] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  useEffect(() => {
    if (profile && !avatar) setAvatar(profile.avatar);
  }, [profile, avatar]);

  useEffect(() => {
    if (!accountLoading && account) router.replace(next);
  }, [account, accountLoading, next, router]);

  // live check whether the username is still free
  useEffect(() => {
    if (mode !== 'register' || username.length < 3) {
      setNameFree(null);
      return undefined;
    }
    const id = setTimeout(() => {
      api(`/api/auth/username?name=${encodeURIComponent(username)}`)
        .then((d) => setNameFree(d.free))
        .catch(() => setNameFree(null));
    }, 350);
    return () => clearTimeout(id);
  }, [username, mode]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== password2) return setError('password_mismatch');
    setBusy(true);
    try {
      const data =
        mode === 'register'
          ? await api('/api/auth/register', {
              method: 'POST',
              body: { username, password, displayName: profile?.name || username, avatar },
            })
          : await api('/api/auth/login', { method: 'POST', body: { username, password } });
      setAccount(data.user);
      router.replace(mode === 'register' && next === '/' ? '/account?welcome=1' : next);
      router.refresh();
    } catch (err) {
      setError(err.code);
      setBusy(false);
    }
  }

  const errText = error ? (t(`auth.err.${error}`) === `auth.err.${error}` ? t('err.network') : t(`auth.err.${error}`)) : '';
  const registering = mode === 'register';
  // only judge the repeat field once something was typed into it
  const repeatState = registering && password2 ? (password === password2 ? 'good' : 'bad') : '';
  // a hidden password is where caps lock hurts
  const watchCaps = (e) => setCapsLock(Boolean(e.getModifierState?.('CapsLock')));
  const passType = showPass ? 'text' : 'password';

  return (
    <div className="page-narrow auth-page">
      <div className="card">
        <div className="tabs" role="tablist">
          {['login', 'register'].map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => {
                setMode(m);
                setError('');
              }}
            >
              <Icon name={m === 'login' ? 'log-in' : 'user-plus'} size={18} />
              {t(`auth.${m}`)}
            </button>
          ))}
        </div>

        <p className="muted auth-intro">{t(mode === 'login' ? 'auth.loginIntro' : 'auth.registerIntro')}</p>

        {discordEnabled && (
          <>
            <a className="btn btn-discord btn-block" href={`/api/auth/discord`}>
              <Icon name="discord" size={22} /> {t('auth.discord')}
            </a>
            <div className="divider">
              <span>{t('auth.or')}</span>
            </div>
          </>
        )}

        <form onSubmit={submit}>
          <label className="label" htmlFor="auth-user">
            {t('auth.username')}
          </label>
          <input
            id="auth-user"
            className="input"
            value={username}
            autoComplete="username"
            maxLength={20}
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={registering && nameFree === false ? true : undefined}
            aria-describedby={registering ? 'auth-user-hint' : undefined}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
          />
          {registering && (
            <p id="auth-user-hint" className={`field-hint ${nameFree === false ? 'bad' : nameFree ? 'good' : ''}`} aria-live="polite">
              {nameFree === false ? t('auth.nameTaken') : nameFree ? t('auth.nameFree') : t('auth.usernameRules')}
            </p>
          )}
          <label className="label" htmlFor="auth-pass">
            {t('auth.password')}
          </label>
          <span className="input-wrap">
            <input
              id="auth-pass"
              className="input"
              type={passType}
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={registering ? 8 : undefined}
              required
              aria-describedby={capsLock ? 'auth-caps' : undefined}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={watchCaps}
              onKeyUp={watchCaps}
              onBlur={() => setCapsLock(false)}
            />
            <button
              type="button"
              className="input-action"
              aria-pressed={showPass}
              aria-label={t(showPass ? 'ui.hidePassword' : 'ui.showPassword')}
              data-tip={t(showPass ? 'ui.hidePassword' : 'ui.showPassword')}
              onClick={() => setShowPass((v) => !v)}
            >
              <Icon name={showPass ? 'eye-off' : 'eye'} size={20} />
            </button>
          </span>
          {capsLock && !showPass && (
            <p id="auth-caps" className="field-hint warn" role="status">
              {t('ui.capsLock')}
            </p>
          )}
          {registering && (
            <>
              <label className="label" htmlFor="auth-pass2">
                {t('auth.password2')}
              </label>
              <input
                id="auth-pass2"
                className="input"
                type={passType}
                value={password2}
                autoComplete="new-password"
                required
                aria-invalid={repeatState === 'bad' ? true : undefined}
                aria-describedby="auth-pass2-hint"
                onChange={(e) => setPassword2(e.target.value)}
                onKeyDown={watchCaps}
                onKeyUp={watchCaps}
                onBlur={() => setCapsLock(false)}
              />
              <p id="auth-pass2-hint" className={`field-hint ${repeatState}`} aria-live="polite">
                {repeatState === 'good'
                  ? t('ui.passwordsMatch')
                  : repeatState === 'bad'
                    ? t('auth.err.password_mismatch')
                    : t('auth.passwordRules')}
              </p>
              <span className="label">{t('home.avatarLabel')}</span>
              {avatar && <AvatarPicker value={avatar} onChange={setAvatar} />}
            </>
          )}
          {errText && (
            <p className="form-error" role="alert">
              {errText}
            </p>
          )}
          <button type="submit" className="btn btn-yellow btn-big btn-block auth-submit" disabled={busy} aria-busy={busy}>
            {busy && <span className="spinner tiny" aria-hidden="true" />}
            {busy ? t('common.loading') : t(mode === 'login' ? 'auth.loginBtn' : 'auth.registerBtn')}
          </button>
        </form>
        {mode === 'register' && (
          <p className="small muted center-text auth-legal">
            {t('auth.legalHint')} <Link href="/legal">{t('nav.legal')}</Link>
          </p>
        )}
        <p className="small center-text">
          <Link href="/">{t('auth.guest')}</Link>
        </p>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import AvatarPicker from './AvatarPicker';
import Icon from './Icon';
import { useApp } from './Providers';

function useFlash() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!msg) return undefined;
    const id = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(id);
  }, [msg]);
  return [msg, setMsg];
}

function errorText(t, code) {
  const key = `auth.err.${code}`;
  const txt = t(key);
  return txt === key ? t('err.network') : txt;
}

export default function AccountPage() {
  const { t, account, accountLoading, setAccount, discordEnabled, logout, streamerMode, setStreamerMode } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [del, setDel] = useState('');
  const [flash, setFlash] = useFlash();
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!accountLoading && !account) router.replace('/login?next=/account');
  }, [account, accountLoading, router]);

  useEffect(() => {
    if (account) {
      setDisplayName(account.displayName);
      setBio(account.bio || '');
      setAvatar(account.avatar);
    }
  }, [account]);

  useEffect(() => {
    if (params.get('welcome')) setFlash({ ok: true, text: t('account.welcome') });
    else if (params.get('linked')) setFlash({ ok: true, text: t('account.discordLinked') });
    else if (params.get('error')) setFlash({ ok: false, text: errorText(t, params.get('error')) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!account) return <div className="page-center">{t('common.loading')}</div>;

  async function run(key, fn, okText) {
    setBusy(key);
    try {
      await fn();
      if (okText) setFlash({ ok: true, text: okText });
    } catch (err) {
      setFlash({ ok: false, text: errorText(t, err.code) });
    } finally {
      setBusy('');
    }
  }

  const saveProfile = (e) => {
    e.preventDefault();
    run(
      'profile',
      async () => {
        const d = await api('/api/me', { method: 'PATCH', body: { displayName, bio, avatar } });
        setAccount(d.user);
      },
      t('account.saved'),
    );
  };

  const savePassword = (e) => {
    e.preventDefault();
    run(
      'password',
      async () => {
        await api('/api/me/password', { method: 'POST', body: { current: pw.current, password: pw.next } });
        setAccount({ ...account, hasPassword: true });
        setPw({ current: '', next: '' });
      },
      t('account.passwordSaved'),
    );
  };

  const unlink = () =>
    run(
      'discord',
      async () => {
        const d = await api('/api/me/discord', { method: 'DELETE', body: {} });
        setAccount(d.user);
      },
      t('account.discordUnlinked'),
    );

  const deleteAccount = (e) => {
    e.preventDefault();
    run('delete', async () => {
      await api('/api/me', {
        method: 'DELETE',
        body: account.hasPassword ? { password: del } : { confirm: del },
      });
      setAccount(null);
      router.replace('/');
    });
  };

  return (
    <div className="page-wide account-page">
      <div className="page-head">
        <h1>{t('account.title')}</h1>
        <div className="row-gap">
          <Link className="btn btn-white" href={`/u/${account.username}`}>
            <Icon name="user" size={18} /> {t('account.viewProfile')}
          </Link>
          <button type="button" className="btn btn-white" onClick={logout}>
            <Icon name="log-out" size={18} /> {t('nav.logout')}
          </button>
        </div>
      </div>

      {flash && (
        <p className={`flash ${flash.ok ? 'ok' : 'bad'}`} role="status">
          {flash.text}
        </p>
      )}

      <div className="account-grid">
        <form className="card" onSubmit={saveProfile}>
          <h2>{t('account.profile')}</h2>
          <p className="muted small">
            {t('auth.username')}: <strong>@{account.username}</strong>
          </p>
          <label className="label" htmlFor="acc-name">
            {t('account.displayName')}
          </label>
          <input id="acc-name" className="input" maxLength={20} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <label className="label" htmlFor="acc-bio">
            {t('account.bio')}
          </label>
          <textarea
            id="acc-bio"
            className="input"
            rows={3}
            maxLength={160}
            value={bio}
            placeholder={t('account.bioPlaceholder')}
            onChange={(e) => setBio(e.target.value)}
          />
          <span className="label">{t('home.avatarLabel')}</span>
          {avatar && <AvatarPicker value={avatar} onChange={setAvatar} />}
          <button type="submit" className="btn btn-yellow btn-block top-gap" disabled={busy === 'profile'}>
            {t('common.save')}
          </button>
        </form>

        <div className="stack">
          <div className="card">
            <h2>{t('account.privacy')}</h2>
            <label className="switch-row">
              <span>
                <strong>{t('account.showMemes')}</strong>
                <small className="muted">{t('account.showMemesHint')}</small>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={Boolean(account.showMemes)}
                disabled={busy === 'showMemes'}
                onChange={(e) => {
                  const on = e.target.checked;
                  run(
                    'showMemes',
                    async () => {
                      const d = await api('/api/me', { method: 'PATCH', body: { showMemes: on } });
                      setAccount(d.user);
                    },
                    on ? t('account.showMemesOn') : t('account.showMemesOff'),
                  );
                }}
              />
            </label>
            <label className="switch-row">
              <span>
                <strong>{t('streamer.title')}</strong>
                <small className="muted">{t('streamer.hint')}</small>
              </span>
              <input type="checkbox" className="switch" checked={streamerMode} onChange={(e) => setStreamerMode(e.target.checked)} />
            </label>
          </div>

          <form className="card" onSubmit={savePassword}>
            <h2>{account.hasPassword ? t('account.changePassword') : t('account.setPassword')}</h2>
            {!account.hasPassword && <p className="muted small">{t('account.setPasswordHint')}</p>}
            <input type="text" name="username" autoComplete="username" value={account.username} readOnly hidden />
            {account.hasPassword && (
              <>
                <label className="label" htmlFor="acc-cur">
                  {t('account.currentPassword')}
                </label>
                <input
                  id="acc-cur"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={pw.current}
                  onChange={(e) => setPw({ ...pw, current: e.target.value })}
                  required
                />
              </>
            )}
            <label className="label" htmlFor="acc-new">
              {t('account.newPassword')}
            </label>
            <input
              id="acc-new"
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              required
            />
            <p className="field-hint">{t('auth.passwordRules')}</p>
            <button type="submit" className="btn btn-white btn-block" disabled={busy === 'password'}>
              <Icon name="key" size={18} /> {t('common.save')}
            </button>
          </form>

          {(discordEnabled || account.discord) && (
            <div className="card">
              <h2>Discord</h2>
              {account.discord ? (
                <>
                  <p className="with-icon left">
                    <Icon name="discord" size={22} /> {t('account.discordConnected', { name: account.discord.name })}
                  </p>
                  <button type="button" className="btn btn-white" onClick={unlink} disabled={busy === 'discord'}>
                    {t('account.discordUnlink')}
                  </button>
                  {!account.hasPassword && <p className="muted small">{t('account.discordUnlinkHint')}</p>}
                </>
              ) : (
                <a className="btn btn-discord" href="/api/auth/discord?link=1">
                  <Icon name="discord" size={22} /> {t('account.discordLink')}
                </a>
              )}
            </div>
          )}

          <form className="card danger-zone" onSubmit={deleteAccount}>
            <h2>{t('account.delete')}</h2>
            <p className="muted small">{t('account.deleteHint')}</p>
            <label className="label" htmlFor="acc-del">
              {account.hasPassword ? t('account.currentPassword') : t('account.typeUsername', { name: account.username })}
            </label>
            <input
              id="acc-del"
              className="input"
              type={account.hasPassword ? 'password' : 'text'}
              autoComplete={account.hasPassword ? 'current-password' : 'off'}
              value={del}
              onChange={(e) => setDel(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-danger btn-block top-gap" disabled={busy === 'delete' || !del}>
              <Icon name="trash" size={18} /> {t('account.deleteBtn')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { inActivity } from '@/lib/activity';
import { api } from '@/lib/api';
import { LANG_COOKIE, normalizeLang, translate } from '@/lib/i18n';
import { loadProfile, saveProfile } from '@/lib/profile';

const AppCtx = createContext(null);
const STREAMER_KEY = 'lt_streamer';

export default function Providers({ lang: initialLang, memeFontFamily, children }) {
  const router = useRouter();
  const [lang, setLangState] = useState(normalizeLang(initialLang));
  const [guest, setGuest] = useState(null);
  // account: undefined = still loading, null = not logged in
  const [account, setAccount] = useState(undefined);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [sanction, setSanction] = useState(null);
  // true while LaughTime runs as a Discord Activity (the activity renders its own header)
  const [activityMode, setActivityMode] = useState(false);
  // streamer mode hides room codes & invite links on this device
  const [streamerMode, setStreamerModeState] = useState(false);

  useEffect(() => {
    try {
      setStreamerModeState(localStorage.getItem(STREAMER_KEY) === '1');
    } catch {
      /* storage blocked */
    }
  }, []);

  const setStreamerMode = useCallback((on) => {
    setStreamerModeState(Boolean(on));
    try {
      localStorage.setItem(STREAMER_KEY, on ? '1' : '0');
    } catch {
      /* storage blocked */
    }
  }, []);

  useEffect(() => {
    setGuest(loadProfile());
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const pid = loadProfile()?.pid;
      const data = await api(`/api/me${pid ? `?pid=${encodeURIComponent(pid)}` : ''}`);
      setAccount(data.user);
      setDiscordEnabled(Boolean(data.discord));
      setSanction(data.sanction || null);
      return data.user;
    } catch {
      setAccount(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshAccount();
  }, [refreshAccount]);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } finally {
      setAccount(null);
      router.push('/');
      router.refresh();
    }
  }, [router]);

  const setLang = useCallback(
    (l, { refresh = true } = {}) => {
      const next = normalizeLang(l);
      // inside the Discord iframe only partitioned third-party cookies are kept
      const attrs = inActivity() ? 'samesite=none; secure; partitioned' : 'samesite=lax';
      document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; ${attrs}`;
      document.documentElement.lang = next;
      setLangState(next);
      if (refresh) router.refresh();
    },
    [router],
  );

  const updateProfile = useCallback(
    (patch) => {
      if (account && patch.avatar) {
        // logged in: the avatar belongs to the account
        setAccount((a) => (a ? { ...a, avatar: patch.avatar } : a));
        api('/api/me', { method: 'PATCH', body: { avatar: patch.avatar } }).catch(() => {});
      }
      setGuest((prev) => {
        const next = { ...(prev || loadProfile()), ...patch };
        saveProfile(next);
        return next;
      });
    },
    [account],
  );

  // the identity used for games: account data wins over the guest profile
  const profile = useMemo(() => {
    if (!guest) return null;
    if (account) return { ...guest, name: account.displayName, avatar: account.avatar, account: true };
    return guest;
  }, [guest, account]);

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t,
      profile,
      updateProfile,
      memeFontFamily,
      account,
      accountLoading: account === undefined,
      setAccount,
      refreshAccount,
      logout,
      discordEnabled,
      streamerMode,
      setStreamerMode,
      sanction,
      setSanction,
      activityMode,
      setActivityMode,
    }),
    [lang, setLang, t, profile, updateProfile, memeFontFamily, account, refreshAccount, logout, discordEnabled, streamerMode, setStreamerMode, sanction, activityMode],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used inside <Providers>');
  return ctx;
}

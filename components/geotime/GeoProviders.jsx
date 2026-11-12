'use client';

/**
 * Gemeinsamer Zustand der GeoTime-Oberfläche: Sprache und Konto.
 *
 * Eigener Kontext, nicht der von LaughTime – die beiden Projekte teilen sich
 * keinen Code, der ihr Aussehen oder ihre Konten betrifft.
 */
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANG_COOKIE, normalizeLang, translate } from '@/lib/geotime/i18n';

const GeoContext = createContext(null);

export function useGeo() {
  const ctx = useContext(GeoContext);
  if (!ctx) throw new Error('useGeo braucht <GeoProviders>');
  return ctx;
}

export default function GeoProviders({ lang: initialLang = 'en', children }) {
  const router = useRouter();
  const [lang, setLangState] = useState(normalizeLang(initialLang));
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    () =>
      fetch('/geotime-api/auth/me')
        .then((r) => r.json())
        .then((d) => {
          setAccount(d.player ? { ...d.player, stats: d.stats } : null);
          if (d.player?.lang) setLangState(normalizeLang(d.player.lang));
        })
        .catch(() => setAccount(null))
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setLang = useCallback((next) => {
    const value = normalizeLang(next);
    setLangState(value);
    document.documentElement.lang = value;
    try {
      document.cookie = `${LANG_COOKIE}=${value}; Path=/; Max-Age=${365 * 86400}; SameSite=Lax`;
    } catch {
      /* egal */
    }
    fetch('/geotime-api/auth/lang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: value }),
    }).catch(() => {});
    // Seiten, die auf dem Server gerendert werden (Startseite), neu holen –
    // sonst bleibt deren Text in der alten Sprache stehen
    router.refresh();
  }, [router]);

  const logout = useCallback(async () => {
    await fetch('/geotime-api/auth/logout', { method: 'POST' }).catch(() => {});
    setAccount(null);
  }, []);

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      account,
      accountLoading: loading,
      setAccount,
      refreshAccount: refresh,
      logout,
    }),
    [lang, setLang, account, loading, refresh, logout],
  );

  return <GeoContext.Provider value={value}>{children}</GeoContext.Provider>;
}

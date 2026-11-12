'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Icon from './Icon';
import { useApp } from './Providers';

// one request for all buttons on a page
let infoJob = null;

/** Public settings of the Discord Activity: { enabled, launchUrl, … } (never throws). */
export function activityInfo() {
  infoJob ||= api('/api/activity/config').catch(() => {
    infoJob = null;
    return { enabled: false, launchUrl: null };
  });
  return infoJob;
}

/**
 * "Play on Discord": opens the activity's page in Discord, where it can be
 * started in a voice channel. Renders nothing while the activity is switched
 * off on this server – so it can be placed anywhere without a check.
 *   onInfo(info)  optional, tells the parent whether the activity is enabled
 */
export default function PlayOnDiscord({ className = 'btn btn-discord', onInfo, children }) {
  const { t } = useApp();
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let alive = true;
    activityInfo().then((info) => {
      if (!alive) return;
      setUrl(info.enabled && /^https:\/\/discord\.com\/activities\/\d+$/.test(info.launchUrl || '') ? info.launchUrl : null);
      onInfo?.(info);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!url) return null;
  return (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer">
      <Icon name="discord" />
      {children || t('activity.playOnDiscord')}
      <Icon name="external" size={16} label={t('activity.playOnDiscord.newTab')} />
    </a>
  );
}

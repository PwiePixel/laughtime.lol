'use client';

import Icon from './Icon';
import { useApp } from './Providers';

export default function StreamerToggle({ compact = false }) {
  const { t, streamerMode, setStreamerMode } = useApp();
  const label = streamerMode ? t('streamer.on') : t('streamer.off');
  return (
    <button
      type="button"
      className={`streamer-toggle ${streamerMode ? 'on' : ''} ${compact ? 'is-compact' : ''}`}
      aria-pressed={streamerMode}
      title={t('streamer.hint')}
      aria-label={compact ? label : undefined}
      onClick={() => setStreamerMode(!streamerMode)}
    >
      <Icon name={streamerMode ? 'eye-off' : 'eye'} size={compact ? 15 : 18} />
      {!compact && <span>{label}</span>}
    </button>
  );
}

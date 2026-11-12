'use client';

import { useState } from 'react';
import Icon from '../Icon';
import PlayOnDiscord from '../PlayOnDiscord';
import { useApp } from '../Providers';

/**
 * /activity opened in a normal browser: explains where the activity lives and
 * offers the two ways to play – on Discord or right here on the website.
 */
export default function ActivityOutside() {
  const { t } = useApp();
  // null = not known yet
  const [enabled, setEnabled] = useState(null);
  return (
    <div className="page-narrow center">
      <div className="card activity-outside">
        <div className="big-icon discord-big" aria-hidden="true">
          <Icon name="discord" size={56} />
        </div>
        <h1>{t('activity.outside.title')}</h1>
        <p className="lead">{t('activity.outside.text')}</p>
        <ol className="activity-howto" aria-label={t('activity.outside.how')}>
          <li>
            <Icon name="headphones" size={22} /> <span>{t('activity.outside.step1')}</span>
          </li>
          <li>
            <Icon name="rocket" size={22} /> <span>{t('activity.outside.step2')}</span>
          </li>
          <li>
            <Icon name="users" size={22} /> <span>{t('activity.outside.step3')}</span>
          </li>
        </ol>
        {enabled === false && (
          <p className="activity-outside-off" role="status">
            <Icon name="alert" size={18} /> {t('activity.outside.off')}
          </p>
        )}
        <div className="activity-outside-actions">
          <PlayOnDiscord onInfo={(info) => setEnabled(Boolean(info.enabled))} />
          <a className={`btn ${enabled ? 'btn-white' : 'btn-yellow'}`} href="/">
            <Icon name="play" /> {t('activity.outside.web')}
          </a>
        </div>
      </div>
    </div>
  );
}

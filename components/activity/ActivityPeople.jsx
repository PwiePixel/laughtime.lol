'use client';

import { useState } from 'react';
import Icon from '../Icon';
import { useApp } from '../Providers';

const MAX_SHOWN = 6;

function Person({ person }) {
  const [broken, setBroken] = useState(false);
  const initial = [...person.name][0]?.toUpperCase() || '?';
  return (
    <li className="activity-person" title={person.name}>
      {person.avatar && !broken ? (
        <img src={person.avatar} alt="" width="28" height="28" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
      <span className="sr-only">{person.name}</span>
    </li>
  );
}

/**
 * Who of the call has LaughTime open right now (from the Discord client, see
 * ActivityRoot). The names and pictures stay in this window – they are not
 * sent to our server.
 */
export default function ActivityPeople({ people }) {
  const { t } = useApp();
  if (!people?.length) return null;
  const shown = people.slice(0, MAX_SHOWN);
  const more = people.length - shown.length;
  return (
    <div className="activity-people">
      <span className="activity-people-label">
        <Icon name="discord" size={16} /> {t(people.length === 1 ? 'activity.people.one' : 'activity.people.many', { n: people.length })}
      </span>
      <ul>
        {shown.map((p) => (
          <Person key={p.id} person={p} />
        ))}
        {more > 0 && (
          <li className="activity-person is-more" aria-label={t('activity.people.more', { n: more })}>
            <span aria-hidden="true">+{more}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

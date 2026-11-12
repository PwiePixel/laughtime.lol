'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { StatTile } from '../admin/Charts';
import Icon from '../Icon';
import { useApp } from '../Providers';

/** Admin dashboard: how much of the live traffic plays in the beta channel. */
export default function AdminBetaTile() {
  const { t, lang } = useApp();
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api('/api/beta/live')
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // no tile while the beta is switched off (BETA_ENABLED=false)
  if (!data?.enabled) return null;
  const nf = new Intl.NumberFormat(lang);
  return (
    <StatTile
      icon={<Icon name="rocket" size={22} />}
      value={nf.format(data.beta.players)}
      label={t('beta.admin.players')}
      sub={t('beta.admin.rooms', { n: nf.format(data.beta.rooms), access: t(`beta.admin.access.${data.access}`) })}
    />
  );
}

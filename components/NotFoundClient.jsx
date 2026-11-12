'use client';

import Link from 'next/link';
import Icon from './Icon';
import { useApp } from './Providers';

export default function NotFoundClient() {
  const { t } = useApp();
  return (
    <div className="page-narrow center">
      <div className="card">
        <div className="big-icon">
          <Icon name="search-x" size={56} />
        </div>
        <h1>404</h1>
        <p>{t('err.room_not_found')}</p>
        <Link className="btn btn-yellow" href="/">
          {t('common.backHome')}
        </Link>
      </div>
    </div>
  );
}

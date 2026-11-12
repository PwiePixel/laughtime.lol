'use client';

import Link from 'next/link';
import Icon from './Icon';
import { useApp } from './Providers';

export default function NotFoundClient() {
  const { t } = useApp();
  return (
    <div className="page-narrow center not-found">
      <div className="card">
        {/* the digits tumble in one after the other (app/community.css) */}
        <p className="nf-code" aria-hidden="true">
          <span>4</span>
          <span className="nf-zero">
            <Icon name="search-x" size={56} />
          </span>
          <span>4</span>
        </p>
        <h1>
          <span className="sr-only">404 – </span>
          {t('ui.notFound.title')}
        </h1>
        <p className="muted">{t('ui.notFound.text')}</p>
        <div className="row-center">
          <Link className="btn btn-yellow" href="/">
            <Icon name="play" size={18} /> {t('common.backHome')}
          </Link>
          <Link className="btn btn-white" href="/memes">
            <Icon name="trophy" size={18} /> {t('ui.notFound.memes')}
          </Link>
        </div>
      </div>
    </div>
  );
}

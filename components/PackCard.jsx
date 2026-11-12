'use client';

import Avatar from './Avatar';
import Icon from './Icon';
import { useApp } from './Providers';

/** thumbnail of a template or clip (clips show their first frame) */
export function MediaThumb({ media, className = '' }) {
  if (!media) {
    return (
      <span className={`media-thumb is-empty ${className}`}>
        <Icon name="package" size={30} />
      </span>
    );
  }
  return (
    <span className={`media-thumb ${className}`}>
      {media.kind === 'video' ? (
        <>
          {media.thumb ? (
            <img src={media.thumb} alt="" loading="lazy" decoding="async" />
          ) : (
            <video src={`${media.src}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" />
          )}
          <span className="gif-tag">GIF</span>
        </>
      ) : (
        <>
          <img src={media.thumb || media.src} alt="" loading="lazy" decoding="async" onError={(e) => media.thumb && e.currentTarget.src !== media.src && (e.currentTarget.src = media.src)} />
          {media.animated && <span className="gif-tag">GIF</span>}
        </>
      )}
      {media.upload && (
        <span className={`upload-tag ${media.approved ? 'is-approved' : ''}`} title={media.approved ? 'approved' : 'upload'}>
          <Icon name={media.approved ? 'approved' : 'upload'} size={12} strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

export default function PackCard({ pack, action, selected, onClick }) {
  const { t } = useApp();
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`pack-card ${selected ? 'is-selected' : ''} ${pack.playable === false ? 'is-small' : ''}`}
      onClick={onClick}
    >
      <MediaThumb media={pack.cover} className="pack-cover" />
      <span className="pack-info">
        <strong className="pack-name">
          {!pack.public && <Icon name="lock" size={14} />} {pack.name}
        </strong>
        <span className="pack-meta">
          <Icon name="images" size={14} /> {t('lobby.pack.items', { n: pack.itemCount })}
          {pack.plays > 0 && (
            <>
              {' · '}
              <Icon name="play" size={13} /> {t('packs.plays', { n: pack.plays })}
            </>
          )}
        </span>
        {pack.owner && (
          <span className="pack-owner">
            <Avatar value={pack.owner.avatar} size={20} /> {pack.owner.displayName}
          </span>
        )}
        {pack.playable === false && <span className="pack-warn">{t('packs.tooSmall', { n: 4 })}</span>}
      </span>
      {action}
    </Tag>
  );
}

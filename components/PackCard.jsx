'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { hasVariants, originalSrc, responsiveImage, useInView } from '@/lib/media';
import Avatar from './Avatar';
import Icon from './Icon';
import { useApp } from './Providers';

/**
 * What to try for a thumbnail, best first: the small preview in the right
 * size, then the picture itself, each also as untouched original in case a
 * scaled variant is not available.
 */
function thumbSources(media, slot) {
  const list = [];
  const add = (src) => {
    if (!src) return;
    if (hasVariants(src)) list.push(responsiveImage(src, { width: slot, intrinsicWidth: src === media.src ? media.width : 0 }));
    list.push({ src: originalSrc(src) });
  };
  add(media.thumb);
  if (media.kind !== 'video') add(media.src);
  return list.filter((c, i) => list.findIndex((x) => x.src === c.src && x.srcSet === c.srcSet) === i);
}

function ThumbImage({ media, size, priority, onGone }) {
  // thumbnails are cropped squares: a wide picture needs more pixels than the box is wide
  const ratio = media.width && media.height ? media.width / media.height : 1;
  const slot = Math.ceil(size * Math.min(3, Math.max(1, ratio)));
  // keyed by the addresses, not the object: lists hand in fresh objects on every update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sources = useMemo(() => thumbSources(media, slot), [media.thumb, media.src, media.kind, media.width, slot]);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const ref = useRef(null);
  const current = sources[Math.min(step, sources.length - 1)];

  useEffect(() => {
    setStep(0);
    setReady(false);
  }, [sources]);

  // a picture from the cache can be complete before React listens for "load"
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth) setReady(true);
  }, [current]);

  if (!current) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      key={`${current.src}|${current.srcSet ? 'v' : 'o'}`}
      className={`thumb-img ${ready ? 'is-ready' : ''}`}
      src={current.src}
      srcSet={current.srcSet}
      sizes={current.srcSet ? `${slot}px` : undefined}
      alt=""
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      onLoad={() => setReady(true)}
      onError={() => (step < sources.length - 1 ? setStep(step + 1) : onGone())}
    />
  );
}

/** first frame of a clip that has no preview picture – only fetched when it comes near the screen */
function ThumbClip({ media }) {
  const ref = useRef(null);
  const near = useInView(ref, { rootMargin: '300px', once: true });
  const [ready, setReady] = useState(false);
  return (
    <video
      ref={ref}
      className={`thumb-img ${ready ? 'is-ready' : ''}`}
      src={near ? `${media.src}#t=0.1` : undefined}
      muted
      playsInline
      preload="metadata"
      aria-hidden="true"
      onLoadedData={() => setReady(true)}
      onLoadedMetadata={() => setReady(true)}
    />
  );
}

/**
 * thumbnail of a template or clip (clips show their first frame).
 *   size      about how wide it is shown (CSS pixels) – picks the image variant
 *   priority  visible right away (e.g. a cover at the top): not lazy
 */
export function MediaThumb({ media, className = '', size = 180, priority = false }) {
  // source whose pictures all failed to load
  const [gone, setGone] = useState(null);
  const broken = Boolean(media) && gone === media.src;
  if (!media || (broken && (media.kind !== 'video' || !media.thumb))) {
    return (
      <span className={`media-thumb is-empty ${className}`}>
        <Icon name="package" size={30} />
      </span>
    );
  }
  // clips without a (working) preview picture show their first frame
  const clip = media.kind === 'video' && (!media.thumb || broken);
  return (
    <span className={`media-thumb has-media ${className}`}>
      {clip ? <ThumbClip media={media} /> : <ThumbImage media={media} size={size} priority={priority} onGone={() => setGone(media.src)} />}
      {(media.kind === 'video' || media.animated) && <span className="gif-tag">GIF</span>}
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
      <MediaThumb media={pack.cover} className="pack-cover" size={62} />
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

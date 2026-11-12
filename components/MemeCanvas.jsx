'use client';

import { useEffect, useRef, useState } from 'react';
import { inActivity } from '@/lib/activity';
import { frameSlotWidth, hasVariants, originalSrc, responsiveImage, useInView } from '@/lib/media';
import { throttle } from '@/lib/timing';
import Icon from './Icon';
import { useApp } from './Providers';

/** Round button in the bottom-right corner: saves the meme incl. captions + LoL logo (PNG / GIF). */
function DownloadButton({ media, captions }) {
  const { t, memeFontFamily } = useApp();
  const [state, setState] = useState('idle'); // idle | busy | failed
  const animated = media.kind === 'video' || media.animated;
  const [progress, setProgress] = useState(0);
  const discord = inActivity();
  const idleLabel = discord ? t('meme.shareDiscord') : t(animated ? 'meme.downloadGif' : 'meme.download');
  const label = state === 'busy' ? `${t('meme.saving')} ${progress}%` : state === 'failed' ? t('meme.failed') : idleLabel;
  return (
    <button
      type="button"
      className={`meme-download is-${state}`}
      title={label}
      aria-label={label}
      disabled={state === 'busy'}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={async (e) => {
        e.stopPropagation();
        setProgress(0);
        setState('busy');
        // a GIF reports every frame – a few updates per second are plenty
        const report = throttle(setProgress, 120);
        try {
          // the export code (and the GIF encoder behind it) is only loaded when somebody saves a meme
          const { downloadMeme } = await import('@/lib/exportMeme');
          // the file is always rendered from the original, never from a scaled variant
          const original = { ...media, src: originalSrc(media.src) };
          await downloadMeme({ media: original, captions }, memeFontFamily, `laughtime-${Date.now().toString(36)}`, report);
          setState('idle');
        } catch (err) {
          console.error(err);
          setState('failed');
          setTimeout(() => setState('idle'), 2500);
        } finally {
          report.cancel();
        }
      }}
    >
      {state === 'busy' ? (
        <span className="dl-progress" style={{ '--p': `${progress * 3.6}deg` }}>
          <span>{progress}</span>
        </span>
      ) : (
        <Icon name={state === 'failed' ? 'alert' : discord ? 'share' : 'download'} size={18} />
      )}
      {animated && state === 'idle' && <span className="gif-tag">GIF</span>}
    </button>
  );
}

/**
 * Shows an image or a short video with meme captions on top.
 * Caption positions are stored in percent and the font size in "percent of
 * the width" (cqw), so the meme looks the same on every screen and in the
 * downloaded file.
 *
 * Loading:
 *   priority  the one picture the player is looking at: loaded first (default: while editing)
 *   lazy      a picture further down a list: loaded when it comes near the screen
 *   sizes     layout width for the browser (default: derived from maxHeight)
 * Pictures from the media proxy are requested in the size they are shown at;
 * clips only play while they are on screen.
 */
export default function MemeCanvas({
  media,
  captions = [],
  maxHeight = '62vh',
  editable = false,
  selected = -1,
  onSelect,
  onMove,
  onFail,
  placeholder,
  downloadable = false,
  className = '',
  priority = editable,
  lazy = false,
  sizes,
  children,
}) {
  const { t } = useApp();
  const frameRef = useRef(null);
  const drag = useRef(null);
  const [ratio, setRatio] = useState(() => (media?.width && media?.height ? media.width / media.height : 1));
  // load state is remembered per source, so a cached image that fires onLoad
  // before the effects run can never get stuck in the loading state
  // loading -> meta (clip: size known, first frame still missing) -> loaded | failed
  const [status, setStatus] = useState({ src: null, state: 'loading' });
  // a variant that could not be loaded is retried once with the original file
  const [plainFor, setPlainFor] = useState(null);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef(null);
  const imgRef = useRef(null);
  const src = media?.src;
  const isVideo = media?.kind === 'video';
  const state = status.src === src ? status.state : 'loading';
  // "loaded" = usable (controls appear), "shown" = the first frame is really there
  const loaded = state === 'loaded' || state === 'meta';
  const shown = state === 'loaded';
  const failed = state === 'failed';
  const setFailed = () => setStatus({ src, state: 'failed' });
  const setShown = () => setStatus({ src, state: 'loaded' });

  // clips in a list are fetched when they come close, and only play while on screen
  const near = useInView(frameRef, { rootMargin: '400px', once: true, enabled: isVideo && lazy });
  const onScreen = useInView(frameRef, { threshold: 0.2, enabled: isVideo });
  const videoSrc = !lazy || near ? src : undefined;

  useEffect(() => {
    if (media?.width && media?.height) setRatio(media.width / media.height);
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) onMediaSize(img.naturalWidth, img.naturalHeight);
    const video = videoRef.current;
    if (video?.readyState >= 2) onMediaSize(video.videoWidth, video.videoHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, media?.width, media?.height]);

  useEffect(() => {
    if (failed) onFail?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  // a clip that may not start on its own (data saver, battery saver) never
  // delivers a first frame: show it anyway instead of a skeleton forever
  useEffect(() => {
    if (state !== 'meta') return undefined;
    const id = setTimeout(() => setStatus((s) => (s.src === src && s.state === 'meta' ? { src, state: 'loaded' } : s)), 1500);
    return () => clearTimeout(id);
  }, [state, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!isVideo || !video || !videoSrc) return;
    if (!onScreen) {
      video.pause();
      return;
    }
    video.play()?.catch(() => {
      // sound without a tap is not allowed: keep the clip running silently
      if (video.muted) return;
      video.muted = true;
      setMuted(true);
      video.play().catch(() => {});
    });
  }, [isVideo, onScreen, videoSrc]);

  function onMediaSize(w, h, ready = true) {
    if (w && h) setRatio(w / h);
    setStatus((s) => (s.src === src && s.state === 'loaded' ? s : { src, state: ready ? 'loaded' : 'meta' }));
  }

  function onImageError() {
    // maybe only the scaled variant is broken: try the original before giving up
    if (hasVariants(src) && plainFor !== src) setPlainFor(src);
    else setFailed();
  }

  function pointerDown(e, i) {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(i);
    const rect = frameRef.current.getBoundingClientRect();
    const c = captions[i];
    drag.current = {
      i,
      rect,
      dx: e.clientX - (rect.left + (c.x / 100) * rect.width),
      dy: e.clientY - (rect.top + (c.y / 100) * rect.height),
      moved: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function pointerMove(e) {
    const d = drag.current;
    if (!d) return;
    const x = ((e.clientX - d.dx - d.rect.left) / d.rect.width) * 100;
    const y = ((e.clientY - d.dy - d.rect.top) / d.rect.height) * 100;
    d.moved = true;
    onMove?.(d.i, Math.max(0, Math.min(100, Math.round(x * 10) / 10)), Math.max(0, Math.min(100, Math.round(y * 10) / 10)));
  }

  function pointerUp() {
    drag.current = null;
  }

  if (!media) return null;
  const safeRatio = Math.max(0.3, Math.min(3.5, ratio || 1));
  const plain = plainFor === src;
  const picture = isVideo || plain
    ? { src: originalSrc(src) }
    : responsiveImage(src, { width: frameSlotWidth(maxHeight, safeRatio), intrinsicWidth: media.width, sizes, lazy: lazy && !priority });

  return (
    <div
      ref={frameRef}
      className={`meme-frame ${editable ? 'is-editable' : ''} ${shown ? 'is-loaded' : ''} ${className}`}
      style={{ '--ar': safeRatio, '--mh': maxHeight }}
      onPointerDown={editable ? () => onSelect?.(-1) : undefined}
    >
      {media.kind === 'video' ? (
        <video
          ref={videoRef}
          key={media.src}
          className="meme-media"
          src={videoSrc}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          width={media.width || undefined}
          height={media.height || undefined}
          onLoadedMetadata={(e) => onMediaSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight, false)}
          onLoadedData={setShown}
          onPlaying={setShown}
          onError={videoSrc ? setFailed : undefined}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          key={plain ? `${media.src}#plain` : media.src}
          className="meme-media"
          src={picture.src}
          srcSet={picture.srcSet}
          sizes={picture.sizes}
          width={media.width || undefined}
          height={media.height || undefined}
          alt={media.title || ''}
          draggable={false}
          loading={lazy && !priority ? 'lazy' : 'eager'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={(e) => onMediaSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          onError={onImageError}
        />
      )}
      {!shown && !failed && <div className="meme-loading" aria-hidden="true" />}
      {failed && (
        <div className="meme-failed" role="img" aria-label={t('media.failed')}>
          <Icon name="alert" size={40} />
        </div>
      )}
      <div className="meme-layer">
        {captions.map((c, i) => {
          const empty = !c.text.trim();
          if (empty && !editable) return null;
          const text = empty ? placeholder?.(i) || '' : c.text;
          return (
            <div
              key={i}
              className={`meme-text ${empty ? 'is-empty' : ''} ${selected === i ? 'is-selected' : ''}`}
              style={{
                left: `${c.x}%`,
                top: `${c.y}%`,
                width: `${c.w}%`,
                fontSize: `${c.size}cqw`,
                color: c.color,
                '--stroke': c.color === '#000000' ? '#FFFFFF' : '#000000',
                textTransform: c.upper ? 'uppercase' : 'none',
              }}
              onPointerDown={(e) => pointerDown(e, i)}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
            >
              {text}
            </div>
          );
        })}
      </div>
      {media.kind === 'video' && loaded && !failed && (
        <button
          type="button"
          className="sound-toggle"
          aria-label={muted ? t('media.soundOn') : t('media.soundOff')}
          aria-pressed={!muted}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setMuted((m) => !m);
            videoRef.current?.play().catch(() => {});
          }}
        >
          <Icon name={muted ? 'volume-off' : 'volume-on'} size={18} />
        </button>
      )}
      {downloadable && loaded && !failed && <DownloadButton media={media} captions={captions} />}
      {children}
    </div>
  );
}

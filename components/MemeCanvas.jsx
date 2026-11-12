'use client';

import { useEffect, useRef, useState } from 'react';
import { inActivity } from '@/lib/activity';
import { downloadMeme } from '@/lib/exportMeme';
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
        try {
          await downloadMeme({ media, captions }, memeFontFamily, `laughtime-${Date.now().toString(36)}`, setProgress);
          setState('idle');
        } catch (err) {
          console.error(err);
          setState('failed');
          setTimeout(() => setState('idle'), 2500);
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
  children,
}) {
  const frameRef = useRef(null);
  const drag = useRef(null);
  const [ratio, setRatio] = useState(() => (media?.width && media?.height ? media.width / media.height : 1));
  // load state is remembered per source, so a cached image that fires onLoad
  // before the effects run can never get stuck in the loading state
  const [status, setStatus] = useState({ src: null, state: 'loading' });
  const [muted, setMuted] = useState(true);
  const videoRef = useRef(null);
  const imgRef = useRef(null);
  const src = media?.src;
  const loaded = status.src === src && status.state === 'loaded';
  const failed = status.src === src && status.state === 'failed';
  const setFailed = () => setStatus({ src, state: 'failed' });

  useEffect(() => {
    if (media?.width && media?.height) setRatio(media.width / media.height);
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth) onMediaSize(img.naturalWidth, img.naturalHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, media?.width, media?.height]);

  useEffect(() => {
    if (failed) onFail?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  function onMediaSize(w, h) {
    if (w && h) setRatio(w / h);
    setStatus({ src, state: 'loaded' });
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

  return (
    <div
      ref={frameRef}
      className={`meme-frame ${editable ? 'is-editable' : ''} ${loaded ? 'is-loaded' : ''} ${className}`}
      style={{ '--ar': safeRatio, '--mh': maxHeight }}
      onPointerDown={editable ? () => onSelect?.(-1) : undefined}
    >
      {media.kind === 'video' ? (
        <video
          ref={videoRef}
          key={media.src}
          src={media.src}
          autoPlay
          muted={muted}
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          onLoadedMetadata={(e) => onMediaSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
          onError={setFailed}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          key={media.src}
          src={media.src}
          alt={media.title || ''}
          draggable={false}
          onLoad={(e) => onMediaSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          onError={setFailed}
        />
      )}
      {!loaded && !failed && <div className="meme-loading" aria-hidden="true" />}
      {failed && (
        <div className="meme-failed">
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
          aria-label={muted ? 'Sound on' : 'Sound off'}
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

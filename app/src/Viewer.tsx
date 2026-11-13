import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parsePoolIds } from './pools';
import type { BlacklistRule, Post, PostDetail } from './types';

function Icon({ name }: { name: string }) { return <img className="icon" src={`./icons/${name}.png`} alt="" />; }
function fileSize(bytes: number) {
  const unit = bytes >= 1048576 ? 'MiB' : 'KiB';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(bytes / (unit === 'MiB' ? 1048576 : 1024))} ${unit}`;
}

interface Props {
  post: Post;
  detail: PostDetail | null;
  detailError: boolean;
  account: boolean;
  accountStale: boolean;
  upvoteBusy: boolean;
  favoriteBusy: boolean;
  blacklist: BlacklistRule[];
  onClose(): void;
  onRefresh(): void;
  onMove(delta: number): void;
  onSearch(query: string): void;
  onBlacklist(tag: string): void;
  onRetryDetail(): void;
  onDownload(combined: boolean): void;
  onVote(): void;
  onFavorite(): void;
  onCopy(): void;
  onCopySource(value: string): void;
  onBrowser(): void;
}

export function Viewer(props: Props) {
  const { post, detail } = props;
  const [playing, setPlaying] = useState(false);
  const [playPending, setPlayPending] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const [fullReady, setFullReady] = useState(false);
  const [imageSourceIndex, setImageSourceIndex] = useState(0);
  const imageArea = useRef<HTMLDivElement>(null);
  const videoElement = useRef<HTMLVideoElement>(null);
  const mediaGeneration = useRef(0);
  const dragging = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const moved = useRef(false);

  useLayoutEffect(() => {
    const viewer = imageArea.current?.closest<HTMLElement>('.viewer');
    viewer?.querySelector<HTMLButtonElement>('.viewer-bar button')?.focus({ preventScroll: true });
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !viewer || document.querySelector('.panel')) return;
      const focusable = [...viewer.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !viewer.contains(document.activeElement))) {
        last.focus(); event.preventDefault();
      } else if (!event.shiftKey && (document.activeElement === last || !viewer.contains(document.activeElement))) {
        first.focus(); event.preventDefault();
      }
    };
    document.addEventListener('keydown', trapTab, true);
    return () => document.removeEventListener('keydown', trapTab, true);
  }, []);

  useLayoutEffect(() => {
    mediaGeneration.current++;
    setPlaying(false); setPlayPending(false); setPlaybackError(false);
    setFullReady(false); setImageSourceIndex(0); setZoom({ scale: 1, x: 0, y: 0 });
  }, [post.id]);
  useEffect(() => {
    const tags = () => { setShowTags(value => !value); setShowInfo(false); };
    const info = () => { setShowInfo(value => !value); setShowTags(false); };
    document.addEventListener('e322-viewer-tags', tags);
    document.addEventListener('e322-viewer-info', info);
    return () => { document.removeEventListener('e322-viewer-tags', tags); document.removeEventListener('e322-viewer-info', info); };
  }, []);

  const ext = post.file_ext?.toLowerCase();
  const video = ext === 'webm' || ext === 'mp4';
  const animatedImage = ext === 'gif' || ext === 'apng';
  const original = detail?.file?.url || post.file_url || '';
  const imageSources = [...new Set((animatedImage
    ? [post.preview_webp, post.preview_url]
    : [detail?.sample?.url, post.sample_url, original, post.preview_url]
  ).filter((url): url is string => Boolean(url)))];
  const src = imageSources[imageSourceIndex] || '';
  const fullImage = !animatedImage || playing ? original : '';

  const wheel = (event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = imageArea.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = event.clientX - rect.left - rect.width / 2;
    const pointerY = event.clientY - rect.top - rect.height / 2;
    setZoom(previous => {
      const scale = Math.max(1, Math.min(6, previous.scale * Math.exp(-event.deltaY * 0.01)));
      const factor = scale / previous.scale;
      return scale === 1 ? { scale: 1, x: 0, y: 0 } : {
        scale,
        x: previous.x + (1 - factor) * (pointerX - previous.x),
        y: previous.y + (1 - factor) * (pointerY - previous.y),
      };
    });
  };

  const pointerDown = (event: React.PointerEvent) => {
    if (zoom.scale <= 1) return;
    dragging.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: React.PointerEvent) => {
    const drag = dragging.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    setZoom(previous => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
    drag.x = event.clientX; drag.y = event.clientY;
  };
  const pointerUp = () => { moved.current = Boolean(dragging.current?.moved); dragging.current = null; };
  const closeOnImage = () => {
    if (moved.current) { moved.current = false; return; }
    props.onClose();
  };

  const tagGroups = detail?.tags ? Object.entries(detail.tags).filter(([, values]) => values.length) : [];
  const pools = parsePoolIds(detail?.pools ?? post.pools);
  const sources = detail?.sources || [];
  const uploadedAt = detail?.created_at && !Number.isNaN(Date.parse(detail.created_at))
    ? new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(detail.created_at)) : null;

  return <motion.div className="viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
    <div className="viewer-backdrop" onClick={props.onClose} />
    <header className="viewer-bar glass">
      <button className="icon-button" title="Close · Esc / Space" onClick={props.onClose}><Icon name="close" /></button>
      <span className="viewer-id">#{post.id}</span>
      <div className="viewer-actions">
        <button className="icon-button" title="Zoom out" onClick={() => setZoom(value => ({ ...value, scale: Math.max(1, value.scale - 0.25), x: value.scale <= 1.25 ? 0 : value.x, y: value.scale <= 1.25 ? 0 : value.y }))}><Icon name="minus" /></button>
        <span className="zoom-label">{Math.round(zoom.scale * 100)}%</span>
        <button className="icon-button" title="Zoom in" onClick={() => setZoom(value => ({ ...value, scale: Math.min(6, value.scale + 0.25) }))}><Icon name="plus" /></button>
        <span className="bar-separator" />
        <button className="icon-button" title="Tags and blacklist · B" onClick={() => { setShowTags(value => !value); setShowInfo(false); }}><Icon name="tag" /></button>
        <button className="icon-button" title="Details · I" onClick={() => { setShowInfo(value => !value); setShowTags(false); }}><Icon name="info" /></button>
        <button className="icon-button" title="Download · ⌘D" onClick={() => props.onDownload(false)}><Icon name="download" /></button>
        {props.accountStale && <button className="icon-button account-refresh" title="Refresh account data" aria-label="Refresh account data" onClick={props.onRefresh}><Icon name="refresh" /></button>}
        <button className={`icon-button ${post.vote === 1 ? 'reaction-active' : ''}`} title={props.accountStale ? 'Refresh results after switching accounts' : props.upvoteBusy ? 'Saving…' : 'Upvote · ⌘U'} aria-label="Upvote" aria-pressed={post.vote === 1} disabled={props.accountStale || props.upvoteBusy} onClick={props.onVote}><Icon name="upvote" /></button>
        <button className={`icon-button ${post.is_favorited ? 'reaction-active' : ''}`} title={props.accountStale ? 'Refresh results after switching accounts' : props.favoriteBusy ? 'Saving…' : 'Favorite · ⌘F'} aria-label="Favorite" aria-pressed={post.is_favorited} disabled={props.accountStale || props.favoriteBusy} onClick={props.onFavorite}><Icon name="favorite" /></button>
        <button className="icon-button" title="Copy link · C" onClick={props.onCopy}><Icon name="link" /></button>
        <button className="icon-button" title="Open in browser" onClick={props.onBrowser}><Icon name="browser" /></button>
        <button className="text-button" title={props.accountStale ? 'Refresh results after switching accounts' : 'Download, upvote and favorite · ⌘S'} disabled={props.accountStale} onClick={() => props.onDownload(true)}>Save +</button>
      </div>
    </header>

    <button className="viewer-arrow left glass" aria-label="Previous post" onClick={() => props.onMove(-1)}><Icon name="back" /></button>
    <div className="viewer-media" ref={imageArea} onWheel={wheel} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onClick={event => { if (event.target === event.currentTarget) closeOnImage(); }}>
      {video ? <div className="video-stage" onClick={event => { if (event.target === event.currentTarget) closeOnImage(); }}>
        <video ref={videoElement} key={post.id} src={original || undefined} controls={playing} preload="metadata" playsInline onClick={event => event.stopPropagation()} />
        {!playing && <button className="video-poster" disabled={playPending || (!original && !props.detailError)} onClick={() => {
          if (!original) { props.onRetryDetail(); return; }
          const generation = mediaGeneration.current;
          setPlayPending(true); setPlaybackError(false);
          void videoElement.current?.play().then(() => {
            if (generation === mediaGeneration.current) setPlaying(true);
          }).catch(() => {
            if (generation === mediaGeneration.current) setPlaybackError(true);
          }).finally(() => {
            if (generation === mediaGeneration.current) setPlayPending(false);
          });
        }}>
          {(post.preview_webp || post.preview_url) && <img src={post.preview_webp || post.preview_url || ''} alt="" />}
          <span className="play-button glass">{playbackError ? 'Retry' : playPending ? 'Loading…' : original ? <Icon name="play" /> : detail ? 'Media unavailable' : props.detailError ? 'Retry' : 'Loading…'}</span>
        </button>}
      </div> :
        <div className="viewer-image-layer" onClick={closeOnImage} style={{ transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` }}>
          {src ? <img src={src} alt={`Post ${post.id}`} draggable={false} onError={() => setImageSourceIndex(index => index + 1)} /> :
            <span className="viewer-image-error">Image unavailable</span>}
          {fullImage && fullImage !== src && <img className={`viewer-original ${fullReady ? 'ready' : ''}`} src={fullImage} alt="" draggable={false}
            onLoad={() => setFullReady(true)} onError={() => { if (animatedImage) { setPlaying(false); setPlaybackError(true); } }} />}
          {animatedImage && !playing && <button className="animation-play glass" title={playbackError ? 'Retry animation' : 'Play animation'}
            disabled={!original && !props.detailError} onPointerDown={event => event.stopPropagation()} onClick={event => {
              event.stopPropagation();
              if (!original) { props.onRetryDetail(); return; }
              setFullReady(false); setPlaybackError(false); setPlaying(true);
            }}><Icon name="play" /></button>}
        </div>}
    </div>
    <button className="viewer-arrow right glass" aria-label="Next post" onClick={() => props.onMove(1)}><Icon name="next" /></button>

    <AnimatePresence>
      {(showTags || showInfo) && <motion.aside className="viewer-side glass" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 24, opacity: 0 }} transition={{ duration: 0.18 }}>
        <div className="side-head"><span>{showTags ? 'Tags' : 'Details'}</span><button className="icon-button" onClick={() => { setShowTags(false); setShowInfo(false); }}><Icon name="close" /></button></div>
        {showTags ? <>
          {!detail && (props.detailError ? <button className="side-retry" onClick={props.onRetryDetail}>Could not load tags · Retry</button> :
            <div className="tag-skeleton" aria-label="Loading tags">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>)}
          {pools.length > 0 && <section className="tag-group"><h3>Pools</h3>{pools.map(id => <button className="pool-link" key={id} onClick={() => props.onSearch(`pool:${id}`)}>#{id}</button>)}</section>}
          {tagGroups.map(([group, values]) => <section className="tag-group" key={group}>
            <h3>{group}</h3>
            {values.map(tag => {
              const rule = props.blacklist.find(item => item.text.toLowerCase() === tag.toLowerCase());
              const blocked = Boolean(rule?.enabled);
              return <div className="tag-line" key={tag}>
                <button className="tag-name" onClick={() => props.onSearch(tag)}>{tag}</button>
                <button className={`tag-toggle ${blocked ? 'active' : ''}`} title={rule ? blocked ? 'Disable temporarily' : 'Enable rule' : 'Add to blacklist'} onClick={() => props.onBlacklist(tag)}>{blocked ? '−' : '+'}</button>
              </div>;
            })}
          </section>)}
        </> : <div className="detail-list">
          <div><span>Rating</span><strong>{post.rating?.toUpperCase()}</strong></div>
          <div><span>Size</span><strong>{post.width} × {post.height}</strong></div>
          <div><span>Format</span><strong>{post.file_ext?.toUpperCase()}</strong></div>
          {detail?.file.size !== undefined && <div><span>File</span><strong>{fileSize(detail.file.size)}</strong></div>}
          {detail?.duration != null && <div><span>Duration</span><strong>{Math.round(detail.duration)} s</strong></div>}
          <div><span>Score</span><strong>{detail?.score?.total ?? post.score}</strong></div>
          <div><span>Favorites</span><strong>{detail?.fav_count ?? post.fav_count}</strong></div>
          {detail?.comment_count !== undefined && <div><span>Comments</span><strong>{detail.comment_count}</strong></div>}
          {uploadedAt && <div><span>Uploaded</span><strong>{uploadedAt}</strong></div>}
          <div><span>Uploader</span><strong>{detail?.uploader_name || post.uploader || '—'}</strong></div>
          {!detail && props.detailError && <button className="side-retry" onClick={props.onRetryDetail}>Could not refresh details · Retry</button>}
          {sources.length > 0 && <section className="detail-sources"><h3>Sources</h3>
            {sources.map((source, index) => <button key={`${index}-${source}`} title={`Copy: ${source}`} aria-label={`Copy source ${source}`} onClick={() => props.onCopySource(source)}>
              <Icon name="link" /><span>{source}</span>
            </button>)}
          </section>}
        </div>}
        {showTags && !props.account && <button className="side-login-hint" onClick={() => props.onBlacklist('')}>Sign in to sync the blacklist</button>}
      </motion.aside>}
    </AnimatePresence>
  </motion.div>;
}

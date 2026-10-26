import { useVirtualizer } from '@tanstack/react-virtual';
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Slot, Settings } from './types';
import { appleTileSize, gridGap, gridRowLayouts, gridTileRadius, reuseGridRowLayouts, type GridRowLayout } from './gridLayout';
import { METADATA_PREFETCH_ROWS, prefetchBounds, shouldLoadNextPage, thumbnailURL, ThumbnailPrefetcher } from './thumbnailPrefetch';

export interface GalleryAnchor { id: number; offset: number }
export interface GalleryHandle {
  scrollToPost(id: number, focus?: boolean): void;
  scrollToTop(): void;
  isNearTop(): boolean;
  captureAnchor(): GalleryAnchor | null;
  restoreAnchor(anchor: GalleryAnchor): void;
}

interface Props {
  slots: Slot[];
  geometrySlots: { id: number; ratio: number }[];
  columns: number;
  style: Settings['gridStyle'];
  focusedId: number | null;
  onOpen(id: number): void;
  onRetryPage(index: number): void;
  onFocus(id: number): void;
  onVisible(firstIndex: number, lastIndex: number, firstPrefetch: number, lastPrefetch: number): void;
  onEnd(): void;
  onColumnsChange(columns: number): void;
  restorePosition?: GalleryAnchor | null;
  onPositionRestored?(): void;
  onScrollPositionChange?(): void;
  loading: boolean;
  hasMore: boolean;
  loadError: boolean;
  onRetry(): void;
  emptyMessage: string;
  emptyActionLabel?: string;
  onEmptyAction?(): void;
}

const MIN_WIDTH = 120;
const TOP_INSET = 48;

const Tile = memo(function Tile({ slot, style, focused, previewStatus, columns, cellWidth, onOpen, onRetryPage, onFocus }: {
  slot: Slot; style: Settings['gridStyle']; focused: boolean; previewStatus: 'pending' | 'ready' | 'failed'; columns: number; cellWidth: number;
  onOpen(id: number): void; onRetryPage(index: number): void; onFocus(id: number): void;
}) {
  const [ready, setReady] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sources = [slot.post?.preview_webp, slot.post?.preview_url].filter((url, index, all): url is string => Boolean(url) && all.indexOf(url) === index);
  const primaryFailed = previewStatus === 'failed';
  const actualSourceIndex = sourceIndex === 0 && primaryFailed && sources.length > 1 ? 1 : sourceIndex;
  const unavailable = slot.unavailable || slot.failed || Boolean(slot.post && !sources.length) || (primaryFailed && sources.length === 1);
  const failedPage = slot.failed && !slot.post;
  const imageUnavailable = !ready && (failed || unavailable);
  const base = sources[actualSourceIndex] || null;
  const src = sourceIndex === 0 && previewStatus === 'pending' ? null :
    base && retry ? `${base}${base.includes('?') ? '&' : '?'}e322_retry=${retry}` : base;
  const imgRef = useRef<HTMLImageElement>(null);
  const radius = `${gridTileRadius(columns)}px`;
  const appleSize = style === 'apple' ? appleTileSize(slot.ratio, cellWidth) : null;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setSourceIndex(0);
    setRetry(0);
    setFailed(false);
  }, [slot.post?.preview_webp, slot.post?.preview_url]);
  // A cached image can finish before React paints the remounted virtual tile.
  // Resolve its skeleton in layout so scrolling back does not flash a blank cell.
  useLayoutEffect(() => { setReady(Boolean(imgRef.current?.complete && imgRef.current?.naturalWidth)); }, [src]);

  const imageError = () => {
    setReady(false);
    if (actualSourceIndex < sources.length - 1) {
      setSourceIndex(actualSourceIndex + 1);
    } else if (retry < 2) {
      timer.current = setTimeout(() => setRetry(value => value + 1), 1800 * (retry + 1));
    } else setFailed(true);
  };

  return <button
    data-post-id={slot.id}
    className={`post-tile ${style} ${focused ? 'focused' : ''} ${slot.reacted ? 'reacted' : ''}`}
    style={{ borderRadius: radius, width: appleSize?.width, height: appleSize?.height, '--tile-radius': radius, '--skeleton-delay': `${(slot.id % 11) * -0.11}s` } as CSSProperties}
    aria-label={failedPage ? `Retry post ${slot.id}` : imageUnavailable && slot.post ? `Open post ${slot.id}, preview unavailable` : unavailable ? `Post ${slot.id} unavailable` : slot.post ? `Post ${slot.id}` : `Loading post ${slot.id}`}
    tabIndex={focused ? 0 : -1}
    onFocus={() => onFocus(slot.id)}
    onClick={() => { if (slot.post) onOpen(slot.id); else if (slot.failed) onRetryPage(slot.pageIndex); }}
  >
    <span className={`tile-skeleton ${ready ? 'revealed' : ''} ${failed || unavailable ? 'failed' : ''}`} aria-hidden="true" />
    {imageUnavailable && <span className="tile-error" aria-hidden="true">{failedPage ? '↻' : '!'}</span>}
    {src && <img ref={imgRef} src={src} alt="" draggable={false} decoding="async" loading="eager"
      className={ready ? 'ready' : ''} onLoad={() => setReady(true)}
      onError={imageError} />}
    {slot.post?.file_ext && ['webm', 'mp4', 'gif', 'apng'].includes(slot.post.file_ext) &&
      <span className="motion-badge" aria-label="Animation">▶</span>}
  </button>;
});

export const GalleryGrid = forwardRef<GalleryHandle, Props>(function GalleryGrid({
  slots, geometrySlots, columns, style, focusedId, onOpen, onRetryPage, onFocus, onVisible, onEnd, onColumnsChange, restorePosition, onPositionRestored, onScrollPositionChange, loading, loadError, onRetry, emptyMessage, emptyActionLabel, onEmptyAction,
}, ref) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [thumbnailVersion, setThumbnailVersion] = useState(0);
  const prefetcher = useRef<ThumbnailPrefetcher | null>(null);
  const thumbnailFrame = useRef<number | null>(null);
  if (!prefetcher.current) prefetcher.current = new ThumbnailPrefetcher(64, () => {
    if (thumbnailFrame.current !== null) return;
    thumbnailFrame.current = requestAnimationFrame(() => {
      thumbnailFrame.current = null;
      setThumbnailVersion(value => value + 1);
    });
  });
  const previewStatus = (slot: Slot) => {
    void thumbnailVersion;
    return prefetcher.current!.status(thumbnailURL(slot));
  };
  const scrollRef = useCallback((element: HTMLDivElement | null) => {
    setScrollElement(element);
    if (element) setWidth(element.getBoundingClientRect().width);
  }, []);

  useLayoutEffect(() => {
    if (!scrollElement) return;
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width || 0;
      setWidth(previous => Math.abs(previous - next) > 0.5 ? next : previous);
    });
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElement]);

  const effectiveColumns = Math.max(2, Math.min(columns, Math.floor((width - 32 + 8) / (MIN_WIDTH + 8))));
  const gap = gridGap(effectiveColumns);
  useEffect(() => { if (width > 0) onColumnsChange(effectiveColumns); }, [effectiveColumns, onColumnsChange, width]);
  const cellWidth = Math.max(64, (width - 32 - (effectiveColumns - 1) * gap) / effectiveColumns);
  const rowCount = width > 0 ? Math.ceil(geometrySlots.length / effectiveColumns) : 0;
  const layoutCache = useRef<{ slots: { id: number; ratio: number }[]; layouts: GridRowLayout[]; style: Settings['gridStyle']; width: number; columns: number; gap: number } | null>(null);
  const rowLayouts = useMemo(() => {
    if (style === 'masonry') return [];
    const previous = layoutCache.current;
    const layouts = previous && previous.style === style && previous.width === width && previous.columns === effectiveColumns && previous.gap === gap
      ? reuseGridRowLayouts(geometrySlots, previous.slots, previous.layouts, effectiveColumns, width - 32, gap, style)
      : gridRowLayouts(geometrySlots, effectiveColumns, width - 32, gap, style);
    layoutCache.current = { slots: geometrySlots, layouts, style, width, columns: effectiveColumns, gap };
    return layouts;
  }, [geometrySlots, style, width, gap, effectiveColumns]);
  const getScrollElement = useCallback(() => scrollElement, [scrollElement]);
  const getRowKey = useCallback((index: number) => geometrySlots[index * effectiveColumns]?.id ?? `row-${index}`, [geometrySlots, effectiveColumns]);
  const getMasonryKey = useCallback((index: number) => geometrySlots[index]?.id ?? `item-${index}`, [geometrySlots]);
  const estimateRow = useCallback((index: number) => (rowLayouts[index]?.height ?? cellWidth) + gap, [rowLayouts, cellWidth, gap]);
  const estimateMasonry = useCallback((index: number) => cellWidth / Math.max(0.55, Math.min(2.2, geometrySlots[index]?.ratio || 1)) + gap, [geometrySlots, cellWidth, gap]);
  const rows = useVirtualizer({
    count: style === 'masonry' ? 0 : rowCount,
    getScrollElement,
    estimateSize: estimateRow,
    getItemKey: getRowKey,
    paddingStart: TOP_INSET,
    overscan: 4,
  });
  const masonry = useVirtualizer({
    count: style === 'masonry' ? slots.length : 0,
    getScrollElement,
    estimateSize: estimateMasonry,
    getItemKey: getMasonryKey,
    lanes: effectiveColumns,
    paddingStart: TOP_INSET,
    overscan: 6,
  });
  const measuredRows = useRef<{ layouts: GridRowLayout[]; style: Settings['gridStyle']; columns: number; width: number; gap: number } | null>(null);
  useLayoutEffect(() => {
    const previous = measuredRows.current;
    measuredRows.current = { layouts: rowLayouts, style, columns: effectiveColumns, width, gap };
    if (style === 'masonry') return;
    if (!previous || previous.style !== style || previous.columns !== effectiveColumns || previous.width !== width || previous.gap !== gap) {
      rows.measure();
      return;
    }
    let changed = 0;
    while (changed < previous.layouts.length && previous.layouts[changed] === rowLayouts[changed]) changed++;
    const existingChanged = previous.layouts.length - changed;
    if (existingChanged > 4) {
      rows.measure();
    } else {
      for (let index = changed; index < previous.layouts.length && index < rowLayouts.length; index++) {
        if (previous.layouts[index].height !== rowLayouts[index].height) rows.resizeItem(index, rowLayouts[index].height + gap);
      }
    }
  }, [rows, rowLayouts, style, effectiveColumns, width, gap]);
  const measuredMasonry = useRef<{ slots: { id: number; ratio: number }[]; columns: number; cellWidth: number } | null>(null);
  useLayoutEffect(() => {
    const previous = measuredMasonry.current;
    measuredMasonry.current = { slots: geometrySlots, columns: effectiveColumns, cellWidth };
    if (style !== 'masonry') return;
    if (!previous || previous.columns !== effectiveColumns || previous.cellWidth !== cellWidth ||
        (previous.slots !== geometrySlots && (previous.slots.length > geometrySlots.length || previous.slots.some((slot, index) =>
          slot.id !== geometrySlots[index]?.id || slot.ratio !== geometrySlots[index]?.ratio)))) masonry.measure();
  }, [masonry, geometrySlots, effectiveColumns, cellWidth, style]);

  const positionVersion = useRef(0);
  const restoreAnchor = useCallback((anchor: GalleryAnchor, done?: () => void) => {
    if (!scrollElement || width <= 0) return;
    const index = slots.findIndex(slot => slot.id === anchor.id);
    if (index < 0) { done?.(); return; }
    const version = ++positionVersion.current;
    if (style === 'masonry') masonry.scrollToIndex(index, { align: 'start' });
    else rows.scrollToIndex(Math.floor(index / effectiveColumns), { align: 'start' });
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (version !== positionVersion.current) return;
        const tile = scrollElement.querySelector<HTMLButtonElement>(`[data-post-id="${anchor.id}"]`);
        if (tile) scrollElement.scrollTop += tile.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top - anchor.offset;
        done?.();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollElement, width, slots, style, masonry, rows, effectiveColumns]);

  useImperativeHandle(ref, () => ({
    scrollToTop() { positionVersion.current++; if (scrollElement) scrollElement.scrollTop = 0; },
    isNearTop() { return !scrollElement || scrollElement.scrollTop < 80; },
    captureAnchor() {
      if (!scrollElement) return null;
      const viewport = scrollElement.getBoundingClientRect();
      const visible = [...scrollElement.querySelectorAll<HTMLButtonElement>('[data-post-id]')]
        .map(tile => ({ tile, rect: tile.getBoundingClientRect() }))
        .filter(({ rect }) => rect.bottom > viewport.top && rect.top < viewport.bottom)
        .sort((a, b) => Math.abs(a.rect.top - viewport.top) - Math.abs(b.rect.top - viewport.top));
      const closest = visible[0];
      return closest ? { id: Number(closest.tile.dataset.postId), offset: closest.rect.top - viewport.top } : null;
    },
    restoreAnchor,
    scrollToPost(id, focus = true) {
      positionVersion.current++;
      const index = slots.findIndex(slot => slot.id === id);
      if (index < 0) return;
      if (style === 'masonry') masonry.scrollToIndex(index, { align: 'center' });
      else rows.scrollToIndex(Math.floor(index / effectiveColumns), { align: 'center' });
      const priorFocus = document.activeElement;
      if (focus) requestAnimationFrame(() => requestAnimationFrame(() => {
        if (document.activeElement !== priorFocus && document.activeElement !== document.body) return;
        scrollElement?.querySelector<HTMLButtonElement>(`[data-post-id="${id}"]`)?.focus({ preventScroll: true });
      }));
    },
  }), [slots, style, masonry, rows, effectiveColumns, scrollElement, restoreAnchor]);

  const virtualItems = style === 'masonry' ? masonry.getVirtualItems() : rows.getVirtualItems();
  const scrollTop = scrollElement?.scrollTop ?? 0;
  const visibleItems = virtualItems.filter(item => item.end >= scrollTop && item.start <= scrollTop + (scrollElement?.clientHeight ?? 0));
  const firstIndex = visibleItems.length ? Math.min(...visibleItems.map(item => item.index)) * (style === 'masonry' ? 1 : effectiveColumns) : 0;
  const lastIndex = visibleItems.length ? Math.min(slots.length - 1,
    (Math.max(...visibleItems.map(item => item.index)) + 1) * (style === 'masonry' ? 1 : effectiveColumns) - 1) : 0;
  const previousLayout = useRef({ style, columns: effectiveColumns, firstIndex });
  useLayoutEffect(() => {
    const previous = previousLayout.current;
    if (slots.length && (previous.style !== style || previous.columns !== effectiveColumns)) {
      const anchor = Math.min(previous.firstIndex, slots.length - 1);
      if (style === 'masonry') masonry.scrollToIndex(anchor, { align: 'start' });
      else rows.scrollToIndex(Math.floor(anchor / effectiveColumns), { align: 'start' });
    }
    previousLayout.current = { style, columns: effectiveColumns, firstIndex };
  }, [style, effectiveColumns, firstIndex, slots.length, masonry, rows]);
  const prefetch = prefetchBounds(firstIndex, lastIndex, effectiveColumns, slots.length, METADATA_PREFETCH_ROWS);
  const contentHeight = style === 'masonry' ? masonry.getTotalSize() : rows.getTotalSize();
  useLayoutEffect(() => {
    if (!restorePosition || !width) return;
    return restoreAnchor(restorePosition, onPositionRestored);
  }, [restorePosition, width, restoreAnchor, onPositionRestored]);
  useEffect(() => {
    if (restorePosition || !slots.length || !virtualItems.length) return;
    onVisible(Math.min(slots.length - 1, firstIndex), lastIndex, prefetch.first, prefetch.last);
    if (!loadError && shouldLoadNextPage(lastIndex, slots.length, effectiveColumns)) onEnd();
  }, [firstIndex, lastIndex, prefetch.first, prefetch.last, slots.length, effectiveColumns, loadError, onVisible, onEnd, virtualItems.length, restorePosition]);

  useEffect(() => {
    if (!restorePosition) prefetcher.current?.update(slots, firstIndex, lastIndex, effectiveColumns);
  }, [slots, firstIndex, lastIndex, effectiveColumns, restorePosition]);
  useEffect(() => () => {
    if (thumbnailFrame.current !== null) cancelAnimationFrame(thumbnailFrame.current);
    prefetcher.current?.dispose();
  }, []);

  return <div className={`gallery-scroller ${(style === 'masonry' ? masonry : rows).isScrolling ? 'scrolling' : ''}`} ref={scrollRef} role="region" aria-label="Gallery" onScroll={onScrollPositionChange}>
    <div className="gallery-space" style={{ height: Math.max(contentHeight + (loadError ? 68 : 24), scrollElement?.clientHeight || 0) }}>
      {style === 'masonry' ? masonry.getVirtualItems().map(item => {
        const slot = slots[item.index];
        if (!slot) return null;
        return <div className="virtual-masonry" key={item.key} style={{
          width: cellWidth, left: 16 + item.lane * (cellWidth + gap),
          height: item.size - gap, transform: `translateY(${item.start}px)`,
        }}><Tile slot={slot} style={style} columns={effectiveColumns} cellWidth={cellWidth} focused={focusedId === slot.id} previewStatus={previewStatus(slot)} onOpen={onOpen} onRetryPage={onRetryPage} onFocus={onFocus} /></div>;
      }) : rows.getVirtualItems().map(item => <div className="virtual-row" key={item.key} style={{
        height: rowLayouts[item.index]?.height ?? cellWidth, transform: `translateY(${item.start}px)`,
        gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))`, gap,
      }}>
        {slots.slice(item.index * effectiveColumns, (item.index + 1) * effectiveColumns).map(slot =>
          <div className="virtual-cell" key={slot.id}><Tile slot={slot} style={style} columns={effectiveColumns} cellWidth={cellWidth} focused={focusedId === slot.id} previewStatus={previewStatus(slot)}
            onOpen={onOpen} onRetryPage={onRetryPage} onFocus={onFocus} /></div>)}
      </div>)}
      {loadError && <button className="gallery-retry" style={{ top: contentHeight + 10 }} onClick={onRetry}>Could not load · Retry</button>}
    </div>
    {!slots.length && !loading && <div className="gallery-empty"><span>{emptyMessage}</span>
      {emptyActionLabel && onEmptyAction && <button onClick={onEmptyAction}>{emptyActionLabel}</button>}
    </div>}
  </div>;
});

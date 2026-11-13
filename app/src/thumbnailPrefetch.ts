import type { Slot } from './types';

export const PREFETCH_ROWS = 25;
export const METADATA_PREFETCH_ROWS = PREFETCH_ROWS + 50;

export function shouldLoadNextPage(lastVisibleIndex: number, count: number, columns: number): boolean {
  return Math.ceil(Math.max(0, count - 1 - lastVisibleIndex) / Math.max(1, columns)) <= METADATA_PREFETCH_ROWS;
}

export function prefetchBounds(first: number, last: number, columns: number, count: number, rows = PREFETCH_ROWS) {
  const radius = rows * columns;
  return { first: Math.max(0, first - radius), last: Math.min(count - 1, last + radius) };
}

export function thumbnailURL(slot: Slot): string | null {
  return slot.post?.preview_webp || slot.post?.preview_url || null;
}

export class ThumbnailPrefetcher {
  private readonly active = new Map<string, HTMLImageElement>();
  private readonly loaded = new Set<string>();
  private readonly failed = new Set<string>();
  private queue: string[] = [];
  private desired = new Set<string>();
  private readonly concurrency: number;
  private readonly changed: () => void;
  private firstVisible = 0;
  private direction: 1 | -1 = 1;

  constructor(concurrency = 6, changed = () => {}) { this.concurrency = concurrency; this.changed = changed; }

  status(url: string | null): 'pending' | 'ready' | 'failed' {
    if (!url) return 'failed';
    if (this.loaded.has(url)) return 'ready';
    if (this.failed.has(url)) return 'failed';
    return 'pending';
  }

  update(slots: Slot[], firstVisible: number, lastVisible: number, columns: number) {
    if (firstVisible !== this.firstVisible) this.direction = firstVisible > this.firstVisible ? 1 : -1;
    this.firstVisible = firstVisible;
    const bounds = prefetchBounds(firstVisible, lastVisible, columns, slots.length);
    const candidates: { url: string; distance: number; band: number }[] = [];
    for (let index = bounds.first; index <= bounds.last; index++) {
      const url = thumbnailURL(slots[index]);
      if (url) {
        const distance = Math.max(firstVisible - index, index - lastVisible, 0);
        const leading = this.direction === 1 ? index > lastVisible : index < firstVisible;
        candidates.push({ url, distance, band: distance === 0 ? 0 : leading ? 1 : 2 });
      }
    }
    candidates.sort((a, b) => a.band - b.band || a.distance - b.distance);
    this.desired = new Set(candidates.map(candidate => candidate.url));
    for (const [url, image] of this.active) {
      if (this.desired.has(url)) continue;
      this.cancelActive(url, image);
    }
    this.queue = candidates.map(candidate => candidate.url)
      .filter(url => !this.active.has(url) && !this.loaded.has(url) && !this.failed.has(url));
    this.pump();
  }

  private cancelActive(url: string, image: HTMLImageElement) {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    this.active.delete(url);
  }

  private pump() {
    while (this.active.size < this.concurrency && this.queue.length) {
      const url = this.queue.shift()!;
      if (!this.desired.has(url) || this.active.has(url) || this.loaded.has(url) || this.failed.has(url)) continue;
      const image = new Image();
      this.active.set(url, image);
      const finish = (success: boolean) => {
        this.active.delete(url);
        const collection = success ? this.loaded : this.failed;
        collection.add(url);
        if (collection.size > (success ? 2500 : 500)) collection.delete(collection.values().next().value!);
        this.changed();
        this.pump();
      };
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = url;
    }
  }

  dispose() {
    this.queue = [];
    this.desired.clear();
    for (const image of this.active.values()) {
      image.onload = null;
      image.onerror = null;
      image.src = '';
    }
    this.active.clear();
  }
}

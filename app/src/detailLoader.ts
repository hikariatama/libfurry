export class DetailLoader<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<number, { promise: Promise<T>; version: number }>();
  private readonly cache = new Map<number, T>();
  private readonly versions = new Map<number, number>();
  private disposed = false;
  private readonly fetch: (id: number) => Promise<T>;
  private readonly delay: number;
  private readonly limit: number;

  constructor(fetch: (id: number) => Promise<T>, delay = 120, limit = 80) {
    this.fetch = fetch;
    this.delay = delay;
    this.limit = limit;
  }

  request(id: number, onValue: (value: T) => void, onError: (error: unknown) => void, immediate = false) {
    this.cancel();
    if (this.disposed) return;
    const cached = this.cache.get(id);
    if (cached) {
      this.cache.delete(id);
      this.cache.set(id, cached);
      onValue(cached);
      return;
    }
    const start = () => {
      if (this.disposed) return;
      const version = this.versions.get(id) || 0;
      let entry = this.pending.get(id);
      if (!entry || entry.version !== version) {
        const promise = this.fetch(id);
        entry = { promise, version };
        this.pending.set(id, entry);
        void promise.then(value => {
          if ((this.versions.get(id) || 0) !== version) return;
          this.cache.set(id, value);
          if (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value!);
        }, () => {}).finally(() => { if (this.pending.get(id)?.promise === promise) this.pending.delete(id); });
      }
      void entry.promise.then(value => {
        if (!this.disposed && (this.versions.get(id) || 0) === version) onValue(value);
      }, error => {
        if (!this.disposed && (this.versions.get(id) || 0) === version) onError(error);
      }).catch(() => {});
    };
    if (immediate) start();
    else this.timer = setTimeout(start, this.delay);
  }

  invalidate(id: number) {
    this.cache.delete(id);
    this.pending.delete(id);
    this.versions.set(id, (this.versions.get(id) || 0) + 1);
  }
  cancel() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  dispose() { this.disposed = true; this.cancel(); this.cache.clear(); this.pending.clear(); this.versions.clear(); }
}

export class PageLoadTracker {
  private readonly pending = new Map<number, number>();

  claim(index: number, generation: number): boolean {
    if (this.pending.get(index) === generation) return false;
    this.pending.set(index, generation);
    return true;
  }

  release(index: number, generation: number): void {
    if (this.pending.get(index) === generation) this.pending.delete(index);
  }

  clear(): void { this.pending.clear(); }
}

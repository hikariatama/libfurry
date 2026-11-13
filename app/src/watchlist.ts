import type { WatchedTag } from './types';

export function watchedTagQuery(name: string): string {
  return `${name} order:id_desc`;
}

export async function collectWatchedIds(
  checkpoint: number, search: (cursor: string) => Promise<{ posts: { id: number }[] }>,
): Promise<number[]> {
  const ids: number[] = [];
  const collected = new Set<number>();
  let cursor = '';
  while (true) {
    const result = await search(cursor);
    for (const post of result.posts) {
      if (checkpoint && post.id <= checkpoint) return ids;
      if (!collected.has(post.id)) { ids.push(post.id); collected.add(post.id); }
    }
    if (!checkpoint || result.posts.length < 160) break;
    const next = `b${result.posts[result.posts.length - 1].id}`;
    if (next === cursor) throw new Error('Tag pages are repeating');
    cursor = next;
  }
  return ids;
}

export function normalizeWatched(watched: WatchedTag[]): WatchedTag[] {
  let changed = false;
  const result = watched.map(item => {
    let checkpoint = Number.isSafeInteger(item.checkpoint) && (item.checkpoint ?? 0) >= 0 ? item.checkpoint! : 0;
    if (item.checkpoint === undefined) {
      for (const id of item.seen) checkpoint = Math.max(checkpoint, id);
      for (const id of item.unseen) checkpoint = Math.max(checkpoint, id);
    }
    const seen = item.seen.filter(id => id > checkpoint);
    if (item.checkpoint === checkpoint && seen.length === item.seen.length) return item;
    changed = true;
    return { ...item, checkpoint, seen };
  });
  return changed ? result : watched;
}

export function markWatchedPost(watched: WatchedTag[], id: number, tags: string): WatchedTag[] {
  const tagSet = new Set(tags.toLowerCase().split(/\s+/));
  let changed = false;
  const next = watched.map(item => {
    if (!tagSet.has(item.name.toLowerCase())) return item;
    const unread = item.unseen.includes(id);
    const outsideCheckpoint = id > (item.checkpoint ?? 0) && !item.seen.includes(id);
    if (!unread && !outsideCheckpoint) return item;
    changed = true;
    return { ...item, unseen: unread ? item.unseen.filter(value => value !== id) : item.unseen,
      seen: outsideCheckpoint ? [...item.seen, id] : item.seen };
  });
  return changed ? next : watched;
}

export function mergeWatchedRefresh(watched: WatchedTag[], found: Map<string, number[]>): WatchedTag[] {
  let changed = false;
  const next = watched.map(item => {
    const ids = found.get(item.name.toLowerCase());
    if (!ids) return item;
    let checkpoint = item.checkpoint ?? 0;
    for (const id of ids) checkpoint = Math.max(checkpoint, id);
    const known = new Set([...item.seen, ...item.unseen]);
    const fresh = ids.filter(id => !known.has(id));
    const seen = item.seen.filter(id => id > checkpoint);
    if (!fresh.length && checkpoint === (item.checkpoint ?? 0) && seen.length === item.seen.length) return item;
    changed = true;
    return { ...item, checkpoint, seen, unseen: [...fresh, ...item.unseen] };
  });
  return changed ? next : watched;
}

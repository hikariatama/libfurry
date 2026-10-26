import { postRatio } from './gridLayout.ts';
import { filterSearchPosts } from './searchResults.ts';
import type { BlacklistRule, Page, Post } from './types';
import type { ReactionOverride } from './reactionVisibility';

export type StoredPage = {
  cursor: string;
  snapshotKey: string;
  slots: { id: number; ratio: number; reacted: boolean }[];
  posts: (Post | null)[] | null;
};

export type RefilteredPages = {
  pages: StoredPage[];
  raw: number;
  available: number;
  blacklisted: number;
  reacted: number;
};

export async function refilterStoredPages(
  pages: StoredPage[], query: string, rules: BlacklistRule[], overrides: Map<number, ReactionOverride>,
  snapshotPage: (page: StoredPage) => Promise<Pick<Page, 'posts'>>,
  cancelled: () => boolean,
): Promise<RefilteredPages | null> {
  const next: StoredPage[] = [];
  const seen = new Set<number>();
  const counts = { raw: 0, available: 0, blacklisted: 0, reacted: 0 };
  for (let start = 0; start < pages.length; start += 4) {
    if (cancelled()) return null;
    const batch = pages.slice(start, start + 4);
    const snapshots = await Promise.all(batch.map(page => snapshotPage(page)));
    if (cancelled()) return null;
    for (let index = 0; index < batch.length; index++) {
      const page = batch[index];
      const raw = snapshots[index].posts;
      counts.raw += raw.length;
      const unique = raw.filter(post => {
        if (seen.has(post.id)) return false;
        seen.add(post.id);
        return true;
      });
      const filtered = filterSearchPosts(unique, query, rules, overrides);
      counts.available += filtered.available;
      counts.blacklisted += filtered.blacklisted;
      counts.reacted += filtered.reacted;
      next.push({
        cursor: page.cursor,
        snapshotKey: page.snapshotKey,
        slots: filtered.posts.map(post => ({ id: post.id, ratio: postRatio(post), reacted: post.vote === 1 || post.is_favorited })),
        posts: page.posts ? filtered.posts : null,
      });
    }
    if (start + 4 < pages.length) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { pages: next, ...counts };
}

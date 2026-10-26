import type { StoredPage } from './blacklistRebuild.ts';
import { postRatio } from './gridLayout.ts';
import { cursorAfter } from './searchPagination.ts';
import { filterSearchPosts } from './searchResults.ts';
import type { ReactionOverride } from './reactionVisibility.ts';
import type { BlacklistRule, Page } from './types';

export interface AccountRefreshResult {
  pages: StoredPage[];
  nextCursor: string | null;
  raw: number;
  available: number;
  blacklisted: number;
  reacted: number;
  ids: Set<number>;
}

export async function refreshAccountPages(
  depth: number, expression: string, query: string, rules: BlacklistRule[], overrides: Map<number, ReactionOverride>,
  search: (cursor: string) => Promise<Page>, cancelled: () => boolean,
): Promise<AccountRefreshResult | null> {
  const result: AccountRefreshResult = {
    pages: [], nextCursor: '', raw: 0, available: 0, blacklisted: 0, reacted: 0, ids: new Set(),
  };
  const seenRaw = new Set<number>();
  let cursor = '';
  for (let index = 0; index < depth; index++) {
    if (cancelled()) return null;
    const page = await search(cursor);
    if (cancelled()) return null;
    result.raw += page.posts.length;
    const unique = page.posts.filter(post => {
      if (seenRaw.has(post.id)) return false;
      seenRaw.add(post.id);
      return true;
    });
    const filtered = filterSearchPosts(unique, query, rules, overrides);
    result.available += filtered.available;
    result.blacklisted += filtered.blacklisted;
    result.reacted += filtered.reacted;
    const visible = filtered.posts;
    for (const post of visible) result.ids.add(post.id);
    result.pages.push({
      cursor, snapshotKey: page.snapshotKey,
      slots: visible.map(post => ({ id: post.id, ratio: postRatio(post), reacted: post.vote === 1 || post.is_favorited })),
      posts: visible,
    });
    const next = cursorAfter(page.posts, cursor, expression);
    if (!next || next === cursor) { result.nextCursor = null; break; }
    result.nextCursor = next;
    cursor = next;
  }
  return result;
}

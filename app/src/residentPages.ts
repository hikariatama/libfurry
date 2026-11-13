import type { StoredPage } from './blacklistRebuild';

export const maxLoadedPages = 24;

export function pruneResidentPages(pages: StoredPage[], first: number, last: number, margin: number): StoredPage[] {
  let loaded = 0;
  for (const page of pages) if (page.posts) loaded++;
  if (loaded <= maxLoadedPages) return pages;

  let changed = false;
  const kept = pages.map((page, index) => {
    if (!page.posts || (index >= first - margin && index <= last + margin)) return page;
    changed = true;
    return { ...page, posts: null };
  });
  return changed ? kept : pages;
}

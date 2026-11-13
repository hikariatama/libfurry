import type { Post } from './types';

export const searchPageSize = 160;

export function cursorAfter(posts: Pick<Post, 'id'>[], cursor: string, expression: string): string | null {
  if (posts.length < searchPageSize) return null;
  const order = expression.split(/\s+/).find(term => term.toLowerCase().startsWith('order:'))?.toLowerCase();
  if (order && order !== 'order:id_desc') {
    const page = Number(cursor) || 1;
    return page < 750 ? String(page + 1) : null;
  }
  return `b${posts[posts.length - 1].id}`;
}

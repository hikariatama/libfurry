import type { Post } from './types';

export type ReactionOverride = Partial<Pick<Post, 'vote' | 'is_favorited'>>;

export function applyLocalReaction(post: Post, override?: ReactionOverride): Post {
  if (!override) return post;
  const vote = override.vote ?? post.vote;
  const favorited = override.is_favorited ?? post.is_favorited;
  return {
    ...post,
    vote,
    is_favorited: favorited,
    score: post.score + (vote === 1 && post.vote !== 1 ? 1 : vote !== 1 && post.vote === 1 ? -1 : 0),
    fav_count: Math.max(0, post.fav_count + (favorited && !post.is_favorited ? 1 : !favorited && post.is_favorited ? -1 : 0)),
  };
}

// Only positive search metatags explicitly request reacted posts. Sort orders and
// negated terms are unrelated to the viewer's own upvotes and favorites.
export function requestsReactedPosts(query: string): boolean {
  return query.split(/\s+/).some(term => {
    const match = term.match(/^(?:votedup|upvote|fav|favoritedby):(\S+)$/i);
    return Boolean(match && !/^(?:false|no|none|0)$/i.test(match[1]));
  });
}

export function visibleForQuery(post: Pick<Post, 'vote' | 'is_favorited'>, query: string): boolean {
  return requestsReactedPosts(query) || (post.vote !== 1 && !post.is_favorited);
}

export function visibleReactedSlot(reacted: boolean, query: string, viewing: boolean): boolean {
  return viewing || !reacted || requestsReactedPosts(query);
}

import { allowedPost } from './blacklist.ts';
import { applyLocalReaction, visibleForQuery, type ReactionOverride } from './reactionVisibility.ts';
import type { BlacklistRule, Post } from './types';

export function filterSearchPosts(raw: Post[], query: string, rules: BlacklistRule[], overrides: Map<number, ReactionOverride>) {
  const posts: Post[] = [];
  let available = 0;
  let blacklisted = 0;
  let reacted = 0;
  for (const item of raw) {
    const post = applyLocalReaction(item, overrides.get(item.id));
    if (!post.preview_webp && !post.preview_url) continue;
    available++;
    if (!allowedPost(post, rules)) blacklisted++;
    else if (!visibleForQuery(post, query)) reacted++;
    else posts.push(post);
  }
  return { posts, available, blacklisted, reacted };
}

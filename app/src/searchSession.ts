import type { StoredPage } from './blacklistRebuild';
import type { ReactionOverride } from './reactionVisibility';
import type { SearchSession } from './types';

export function captureSearchSession(
  state: Omit<SearchSession, 'version' | 'pages' | 'reactions'>,
  pages: StoredPage[], reactions: Map<number, ReactionOverride>,
): SearchSession {
  return {
    ...state, version: 1,
    anchor: state.anchor && pages.some(page => page.slots.some(slot => slot.id === state.anchor?.id)) ? state.anchor : null,
    pages: pages.map(page => ({ cursor: page.cursor, snapshotKey: page.snapshotKey, slots: page.slots })),
    reactions: [...reactions].map(([id, value]) => ({ id, ...value })),
  };
}

export function resumeSearchSession(session: SearchSession, confirmedAccountId?: number | null) {
  const pages: StoredPage[] = session.pages.map(page => ({ ...page, posts: null }));
  const ids = new Set(pages.flatMap(page => page.slots.map(slot => slot.id)));
  const reactions = new Map<number, ReactionOverride>(confirmedAccountId === undefined || confirmedAccountId === session.accountId
    ? session.reactions.map(({ id, ...value }) => [id, value]) : []);
  return { pages, ids, reactions, anchor: session.anchor && ids.has(session.anchor.id) ? session.anchor : null };
}

export function discardResumedReactions(current: Map<number, ReactionOverride>, resumed: Map<number, ReactionOverride>) {
  return new Map([...current].filter(([id, value]) => value !== resumed.get(id)));
}

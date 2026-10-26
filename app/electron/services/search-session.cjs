const id = value => Number.isSafeInteger(value) && value > 0;
const cursor = value => typeof value === 'string' && value.length <= 32 && /^(?:b?[1-9]\d*)?$/.test(value);
const text = value => typeof value === 'string' && value.length <= 10000;
const count = value => Number.isSafeInteger(value) && value >= 0;

function normalizeSession(value) {
  if (!value || value.version !== 1 || !text(value.query) || !value.query.trim() || !text(value.draft) ||
      !['all', 's', 'q', 'e'].includes(value.rating) || (value.accountId !== null && !id(value.accountId)) ||
      !Array.isArray(value.pages) || value.pages.length > 10000 ||
      (value.nextCursor !== null && !cursor(value.nextCursor)) ||
      !value.counts || !['raw', 'available', 'blacklisted', 'reacted'].every(key => count(value.counts[key])) ||
      !Array.isArray(value.reactions) || value.reactions.length > 1000000) throw new Error('Invalid search session');
  const seen = new Set();
  const pages = value.pages.map(page => {
    if (!page || !cursor(page.cursor) || typeof page.snapshotKey !== 'string' || !/^[a-f0-9]{64}$/.test(page.snapshotKey) ||
        !Array.isArray(page.slots) || page.slots.length > 160) throw new Error('Invalid session page');
    const slots = page.slots.map(slot => {
      if (!slot || !id(slot.id) || seen.has(slot.id) || !Number.isFinite(slot.ratio) || slot.ratio <= 0 ||
          typeof slot.reacted !== 'boolean') throw new Error('Invalid session post');
      seen.add(slot.id);
      if (seen.size > 1000000) throw new Error('Search session is too large');
      return { id: slot.id, ratio: slot.ratio, reacted: slot.reacted };
    });
    return { cursor: page.cursor, snapshotKey: page.snapshotKey, slots };
  });
  const anchor = value.anchor;
  if (anchor !== null && (!anchor || !seen.has(anchor.id) || !Number.isFinite(anchor.offset) || Math.abs(anchor.offset) > 100000)) {
    throw new Error('Invalid session scroll position');
  }
  const reactions = value.reactions.map(reaction => {
    if (!reaction || !id(reaction.id) || (reaction.vote !== undefined && ![-1, 0, 1].includes(reaction.vote)) ||
        (reaction.is_favorited !== undefined && typeof reaction.is_favorited !== 'boolean')) throw new Error('Invalid session reaction');
    return { id: reaction.id, ...(reaction.vote !== undefined ? { vote: reaction.vote } : {}),
      ...(reaction.is_favorited !== undefined ? { is_favorited: reaction.is_favorited } : {}) };
  });
  return {
    version: 1, query: value.query, draft: value.draft, rating: value.rating, accountId: value.accountId,
    pages, nextCursor: value.nextCursor, anchor: anchor ? { id: anchor.id, offset: anchor.offset } : null,
    counts: Object.fromEntries(['raw', 'available', 'blacklisted', 'reacted'].map(key => [key, value.counts[key]])), reactions,
  };
}

class SearchSessionStore {
  constructor(storage) {
    this.storage = storage;
    this.value = null;
    this.writable = true;
    this.tail = Promise.resolve();
  }

  async load() {
    const loaded = await this.storage.recoverJSON('session.json', null, value => {
      if (value === null) return true;
      try { normalizeSession(value); return true; } catch { return false; }
    });
    this.value = loaded.value === null ? null : normalizeSession(loaded.value);
    this.writable = loaded.writable;
    return { ...loaded, value: this.value };
  }

  write(value) {
    if (!this.writable) return Promise.reject(new Error('Search session is read-only'));
    const normalized = normalizeSession(value);
    const write = this.tail.then(() => this.storage.saveJSON('session.json', normalized)).then(() => {
      this.value = normalized;
      return normalized;
    });
    this.tail = write.catch(() => {});
    return write;
  }

  flush() { return this.tail; }
}

module.exports = { normalizeSession, SearchSessionStore };

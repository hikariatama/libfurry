const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshAccountPages } = require('../src/accountRefresh.ts');

const post = (id, tags = 'fox', vote = 0) => ({
  id, tags, vote, is_favorited: false, width: 240, height: 160,
  preview_url: `https://static.e621.net/${id}.jpg`, preview_webp: null,
});

test('account refresh replaces guest reactions and blacklist across the loaded depth', async () => {
  const first = Array.from({ length: 160 }, (_, index) => post(1000 - index, index === 0 ? 'cat' : 'fox', index === 1 ? 1 : 0));
  const second = [post(840), post(839, 'fox', 1)];
  const cursors = [];
  const result = await refreshAccountPages(2, 'order:hot', 'order:hot', [{ text: 'cat', enabled: true }], new Map(),
    async cursor => {
      cursors.push(cursor);
      return { posts: cursor ? second : first, snapshotKey: cursor || 'first', fromCache: false };
    }, () => false);
  assert.deepEqual(cursors, ['', '2']);
  assert.equal(result.raw, 162);
  assert.equal(result.blacklisted, 1);
  assert.equal(result.reacted, 2);
  assert.equal(result.pages[0].slots.some(slot => slot.id === 999), false);
  assert.deepEqual(result.pages[1].slots.map(slot => slot.id), [840]);
  assert.equal(result.nextCursor, null);
});

test('account refresh discards a response after the account or search changes', async () => {
  let cancelled = false;
  const result = await refreshAccountPages(2, 'fox', 'fox', [], new Map(), async () => {
    cancelled = true;
    return { posts: [post(1)], snapshotKey: 'first', fromCache: false };
  }, () => cancelled);
  assert.equal(result, null);
});

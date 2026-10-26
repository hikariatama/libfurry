const test = require('node:test');
const assert = require('node:assert/strict');
const { refilterStoredPages } = require('../src/blacklistRebuild.ts');

const post = (id, tags) => ({ id, tags, width: 120, height: 100, preview_url: `https://static.e621.net/${id}.jpg`, vote: 0, is_favorited: false });

test('blacklist changes rebuild every saved page without a new search or retaining distant posts', async () => {
  const snapshots = new Map([
    ['first', [post(1, 'fox'), post(2, 'cat')]],
    ['second', [post(2, 'cat'), post(3, 'fox')]],
  ]);
  const pages = [
    { cursor: '', snapshotKey: 'first', slots: [], posts: [] },
    { cursor: 'b2', snapshotKey: 'second', slots: [], posts: null },
  ];
  const load = async page => ({ posts: snapshots.get(page.snapshotKey) });
  const hidden = await refilterStoredPages(pages, 'rating:safe', [{ text: 'fox', enabled: true }], new Map(), load, () => false);
  assert.deepEqual(hidden.pages.map(page => page.slots.map(slot => slot.id)), [[2], []]);
  assert.equal(hidden.pages[1].posts, null);
  assert.equal(hidden.blacklisted, 2);

  const shown = await refilterStoredPages(pages, 'rating:safe', [{ text: 'fox', enabled: false }], new Map(), load, () => false);
  assert.deepEqual(shown.pages.map(page => page.slots.map(slot => slot.id)), [[1, 2], [3]]);
  assert.equal(shown.pages[1].posts, null);
  assert.equal(shown.available, 3);
});

test('an obsolete blacklist rebuild stops before changing page state', async () => {
  let cancelled = false;
  const pages = [{ cursor: '', snapshotKey: 'first', slots: [], posts: [] }];
  const result = await refilterStoredPages(pages, '', [], new Map(), async () => {
    cancelled = true;
    return { posts: [post(1, 'fox')] };
  }, () => cancelled);
  assert.equal(result, null);
});

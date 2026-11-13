const test = require('node:test');
const assert = require('node:assert/strict');
const { applyLocalReaction, requestsReactedPosts, visibleForQuery, visibleReactedSlot } = require('../src/reactionVisibility.ts');
const { METADATA_PREFETCH_ROWS, shouldLoadNextPage, prefetchBounds, ThumbnailPrefetcher } = require('../src/thumbnailPrefetch.ts');
const { appleTileSize, gridRowLayouts, reuseGeometrySlots, reuseGridRowLayouts } = require('../src/gridLayout.ts');

test('reacted posts require a positive explicit search metatag', () => {
  for (const query of ['rating:safe male', 'order:hot', 'order:favcount', '-fav:me', '-votedup:me', 'fav:false', 'upvote:no', 'votedup:0', 'favoritedby:none']) {
    assert.equal(requestsReactedPosts(query), false, query);
    assert.equal(visibleForQuery({ vote: 1, is_favorited: false }, query), false, query);
    assert.equal(visibleForQuery({ vote: 0, is_favorited: true }, query), false, query);
    assert.equal(visibleForQuery({ vote: 1, is_favorited: true }, query), false, query);
    assert.equal(visibleForQuery({ vote: 0, is_favorited: false }, query), true, query);
  }
  for (const query of ['votedup:me', 'upvote:me rating:s', 'fav:me', 'favoritedby:someone']) {
    assert.equal(requestsReactedPosts(query), true, query);
    assert.equal(visibleForQuery({ vote: 1, is_favorited: true }, query), true, query);
  }
});

test('a newly reacted tile stays available in the viewer and hides on close', () => {
  assert.equal(visibleReactedSlot(true, 'rating:safe male', true), true);
  assert.equal(visibleReactedSlot(true, 'rating:safe male', false), false);
  assert.equal(visibleReactedSlot(true, 'fav:me rating:safe', false), true);
  assert.equal(visibleReactedSlot(false, 'rating:safe male', false), true);
});

test('local reactions override stale cached post flags without double counting fresh data', () => {
  const old = { id: 42, vote: 0, is_favorited: false, score: 10, fav_count: 3 };
  const update = { vote: 1, is_favorited: true };
  const restored = applyLocalReaction(old, update);
  assert.deepEqual([restored.vote, restored.is_favorited, restored.score, restored.fav_count], [1, true, 11, 4]);
  assert.equal(visibleForQuery(restored, 'rating:safe male'), false);
  const fresh = { ...old, vote: 1, is_favorited: true, score: 11, fav_count: 4 };
  assert.deepEqual(applyLocalReaction(fresh, update), fresh);
  const unfavorited = applyLocalReaction(fresh, { vote: 1, is_favorited: false });
  assert.equal(unfavorited.fav_count, 3);
});

test('prefetch range covers exactly 25 rows on each side', () => {
  assert.deepEqual(prefetchBounds(500, 509, 10, 2000), { first: 250, last: 759 });
  assert.deepEqual(prefetchBounds(4, 11, 4, 100), { first: 0, last: 99 });
  assert.equal(METADATA_PREFETCH_ROWS, 75);
  assert.deepEqual(prefetchBounds(500, 509, 10, 2000, METADATA_PREFETCH_ROWS), { first: 0, last: 1259 });
  assert.equal(shouldLoadNextPage(399, 1000, 8), true);
  assert.equal(shouldLoadNextPage(390, 1000, 8), false);
});

test('Apple grid keeps equal columns and centered natural-ratio tiles', () => {
  const slots = [1, 2, 0.5, 2, 2].map(ratio => ({ ratio }));
  const rows = gridRowLayouts(slots, 2, 400, 8, 'apple');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.width), [400, 400, 400]);
  assert.deepEqual(rows.map(row => row.height), [196, 196, 98]);
  assert.deepEqual(appleTileSize(2, 196), { width: 196, height: 98 });
  assert.deepEqual(appleTileSize(0.5, 196), { width: 98, height: 196 });
  const tallLast = gridRowLayouts([{ ratio: 1 }, { ratio: 1 }, { ratio: 0.5 }], 2, 400, 8, 'apple')[1];
  assert.equal(tallLast.height, 196);
  assert.equal(tallLast.width, 400);
  assert.deepEqual(gridRowLayouts(slots, 2, 400, 8, 'square').map(row => row.height), [196, 196, 196]);
});

test('restoring page data keeps Apple row measurements, while changed slots rebuild from their row', () => {
  const first = [1, 2, 3, 4, 5].map(id => ({ id, ratio: id / 4 + 0.5 }));
  const initial = gridRowLayouts(first, 2, 400, 8, 'apple');
  assert.equal(reuseGridRowLayouts(first.map(slot => ({ ...slot })), first, initial, 2, 400, 8, 'apple'), initial);
  const appended = [...first, { id: 6, ratio: 2 }];
  assert.deepEqual(reuseGridRowLayouts(appended, first, initial, 2, 400, 8, 'apple'), gridRowLayouts(appended, 2, 400, 8, 'apple'));
  const filtered = first.filter(slot => slot.id !== 3);
  assert.deepEqual(reuseGridRowLayouts(filtered, first, initial, 2, 400, 8, 'apple'), gridRowLayouts(filtered, 2, 400, 8, 'apple'));
});

test('restoring post bodies does not invalidate layout or retain them in geometry', () => {
  const first = reuseGeometrySlots([{ id: 1, ratio: 1, post: { id: 1 } }], []);
  assert.deepEqual(first, [{ id: 1, ratio: 1 }]);
  assert.equal(reuseGeometrySlots([{ id: 1, ratio: 1, post: null }], first), first);
  assert.notEqual(reuseGeometrySlots([{ id: 1, ratio: 2, post: null }], first), first);
});

test('thumbnail loading is bounded and drops an obsolete range', () => {
  const created = [];
  const originalImage = global.Image;
  class FakeImage {
    onload = null;
    onerror = null;
    set src(value) { this.url = value; if (value) created.push(this); }
    get src() { return this.url; }
  }
  global.Image = FakeImage;
  try {
    const slots = Array.from({ length: 300 }, (_, index) => ({ post: { preview_webp: `https://example.com/${index}` } }));
    const loader = new ThumbnailPrefetcher(4);
    loader.update(slots, 20, 24, 2);
    assert.equal(created.length, 4);
    created[0].onload();
    assert.equal(created.length, 5);
    const stale = created[1];
    loader.update(slots, 250, 254, 2);
    assert.equal(stale.onload, null);
    assert.ok(created.length <= 9);
    loader.dispose();
    assert.equal(created.at(-1).onload, null);
  } finally {
    global.Image = originalImage;
  }
});

test('thumbnail queue reports loaded and failed previews to the grid', () => {
  const created = [];
  const originalImage = global.Image;
  class FakeImage {
    onload = null;
    onerror = null;
    set src(value) { this.url = value; if (value) created.push(this); }
    get src() { return this.url; }
  }
  global.Image = FakeImage;
  try {
    let changes = 0;
    const loader = new ThumbnailPrefetcher(1, () => changes++);
    loader.update([{ post: { preview_webp: 'https://example.com/one' } }, { post: { preview_webp: 'https://example.com/two' } }], 0, 1, 2);
    assert.equal(loader.status('https://example.com/one'), 'pending');
    created[0].onload();
    assert.equal(loader.status('https://example.com/one'), 'ready');
    created[1].onerror();
    assert.equal(loader.status('https://example.com/two'), 'failed');
    assert.equal(changes, 2);
    loader.dispose();
  } finally {
    global.Image = originalImage;
  }
});

test('thumbnail queue prioritizes the scroll direction without cancelling nearby requests', () => {
  const created = [];
  const originalImage = global.Image;
  class FakeImage {
    onload = null;
    onerror = null;
    set src(value) { this.url = value; if (value) created.push(this); }
    get src() { return this.url; }
  }
  global.Image = FakeImage;
  try {
    const slots = Array.from({ length: 100 }, (_, index) => ({ post: { preview_webp: `https://example.com/${index}` } }));
    const loader = new ThumbnailPrefetcher(1);
    loader.update(slots, 20, 20, 1);
    assert.equal(created[0].url, 'https://example.com/20');
    created[0].onload();
    assert.equal(created[1].url, 'https://example.com/21');
    loader.update(slots, 22, 22, 1);
    assert.notEqual(created[1].onload, null);
    created[1].onload();
    assert.equal(created[2].url, 'https://example.com/22');
    loader.update(slots, 19, 19, 1);
    assert.notEqual(created[2].onload, null);
    created[2].onload();
    assert.equal(created[3].url, 'https://example.com/19');
    created[3].onload();
    assert.equal(created[4].url, 'https://example.com/18');
    loader.dispose();
  } finally {
    global.Image = originalImage;
  }
});

test('thumbnail prefetch never loads a sample without a static preview', () => {
  const { thumbnailURL } = require('../src/thumbnailPrefetch.ts');
  assert.equal(thumbnailURL({ post: { preview_webp: null, preview_url: null, sample_url: 'https://example.invalid/full.gif' } }), null);
  assert.equal(thumbnailURL({ post: { preview_webp: null, preview_url: 'https://example.invalid/preview.jpg', sample_url: 'https://example.invalid/full.gif' } }), 'https://example.invalid/preview.jpg');
});

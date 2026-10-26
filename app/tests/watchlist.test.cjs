const test = require('node:test');
const assert = require('node:assert/strict');
const { collectWatchedIds, markWatchedPost, mergeWatchedRefresh, normalizeWatched, watchedTagQuery } = require('../src/watchlist.ts');

test('tracked tags request newest IDs before applying the checkpoint', () => {
  assert.equal(watchedTagQuery('fox'), 'fox order:id_desc');
});

test('tracked tags page past 160 new posts until reaching a known post', async () => {
  const cursors = [];
  const first = Array.from({ length: 160 }, (_, index) => ({ id: 500 - index }));
  const second = [{ id: 340 }, { id: 339 }, { id: 338 }];
  const ids = await collectWatchedIds(339, async cursor => {
    cursors.push(cursor);
    return { posts: cursor ? second : first };
  });
  assert.deepEqual(cursors, ['', 'b341']);
  assert.deepEqual(ids.slice(-2), [341, 340]);
});

test('tracked tags count more than four pages without including old posts', async () => {
  const firstId = 1000;
  let requests = 0;
  const ids = await collectWatchedIds(200, async cursor => {
    requests++;
    const start = cursor ? Number(cursor.slice(1)) - 1 : firstId;
    return { posts: Array.from({ length: 160 }, (_, index) => ({ id: start - index })) };
  });
  assert.equal(requests, 6);
  assert.equal(ids.length, 800);
  assert.equal(ids[0], 1000);
  assert.equal(ids.at(-1), 201);
});

test('tracked tags keep an exact unread count past the former 500-post limit', () => {
  const fresh = Array.from({ length: 800 }, (_, index) => 1000 - index);
  const refreshed = mergeWatchedRefresh([{ name: 'fox', seen: [], unseen: [], checkpoint: 200 }], new Map([['fox', fresh]]));
  assert.equal(refreshed[0].unseen.length, 800);
  const viewed = markWatchedPost(refreshed, 201, 'fox');
  assert.equal(viewed[0].unseen.length, 799);
  assert.deepEqual(viewed[0].seen, []);
  assert.equal(viewed[0].checkpoint, 1000);
});

test('new tracked tags read only the first page', async () => {
  let requests = 0;
  const ids = await collectWatchedIds(0, async () => {
    requests++;
    return { posts: Array.from({ length: 160 }, (_, index) => ({ id: index + 1 })) };
  });
  assert.equal(requests, 1);
  assert.equal(ids.length, 160);
});

test('watch refresh does not restore a post marked seen while the request was in flight', () => {
  const initial = [{ name: 'fox', seen: [], unseen: [], checkpoint: 0 }];
  const viewed = markWatchedPost(initial, 1, 'male fox');
  const refreshed = mergeWatchedRefresh(viewed, new Map([['fox', [1, 2]]]));
  assert.deepEqual(refreshed[0], { name: 'fox', seen: [], unseen: [2], checkpoint: 2 });
  assert.deepEqual(markWatchedPost(refreshed, 2, 'fox'), [{ name: 'fox', seen: [], unseen: [], checkpoint: 2 }]);
});

test('opening a newer post does not skip unseen posts before the next tag refresh', async () => {
  const opened = markWatchedPost([{ name: 'fox', seen: [], unseen: [], checkpoint: 100 }], 105, 'fox');
  assert.deepEqual(opened[0].seen, [105]);
  const ids = await collectWatchedIds(opened[0].checkpoint, async () => ({
    posts: [105, 104, 103, 102, 101, 100].map(id => ({ id })),
  }));
  assert.deepEqual(ids, [105, 104, 103, 102, 101]);
  const refreshed = mergeWatchedRefresh(opened, new Map([['fox', ids]]));
  assert.deepEqual(refreshed[0].unseen, [104, 103, 102, 101]);
  assert.deepEqual(refreshed[0].seen, []);
  assert.equal(refreshed[0].checkpoint, 105);
});

test('legacy seen IDs migrate to a checkpoint without keeping the whole history', () => {
  const old = [{ name: 'fox', seen: Array.from({ length: 800 }, (_, index) => index + 1), unseen: [801] }];
  const normalized = normalizeWatched(old);
  assert.equal(normalized[0].checkpoint, 801);
  assert.deepEqual(normalized[0].seen, []);
  assert.deepEqual(normalized[0].unseen, [801]);
  assert.strictEqual(normalizeWatched(normalized), normalized);
});

test('removed watched tags stay removed when an older refresh returns', () => {
  const latest = [{ name: 'cat', seen: [], unseen: [] }];
  assert.strictEqual(mergeWatchedRefresh(latest, new Map([['fox', [1, 2]]])), latest);
});

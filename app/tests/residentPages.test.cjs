const test = require('node:test');
const assert = require('node:assert/strict');
const { maxLoadedPages, pruneResidentPages } = require('../src/residentPages.ts');

const makePages = count => Array.from({ length: count }, (_, index) => ({
  cursor: String(index), snapshotKey: String(index), slots: [{ id: index, ratio: 1, reacted: false }], posts: [{ id: index }],
}));

test('resident page data stays stable during ordinary scrolling', () => {
  const pages = makePages(maxLoadedPages);
  assert.equal(pruneResidentPages(pages, 18, 23, 3), pages);
});

test('resident page data is released in batches while nearby pages remain loaded', () => {
  const pages = makePages(maxLoadedPages + 1);
  const pruned = pruneResidentPages(pages, 19, 24, 3);
  assert.notEqual(pruned, pages);
  assert.equal(pruned[0].posts, null);
  assert.equal(pruned[15].posts, null);
  assert.equal(pruned[16].posts, pages[16].posts);
  assert.equal(pruned[24].posts, pages[24].posts);
  assert.equal(pruneResidentPages(pruned, 19, 24, 3), pruned);
});

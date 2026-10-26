const test = require('node:test');
const assert = require('node:assert/strict');
const { cursorAfter } = require('../src/searchPagination.ts');

const posts = Array.from({ length: 160 }, (_, index) => ({ id: 1000 - index }));

test('default and descending ID searches continue below the last ID', () => {
  assert.equal(cursorAfter(posts, '', 'rating:safe'), 'b841');
  assert.equal(cursorAfter(posts, '', 'rating:safe order:id_desc'), 'b841');
});

test('ascending ID and ranked searches use numbered pages', () => {
  assert.equal(cursorAfter(posts, '', 'rating:safe order:id'), '2');
  assert.equal(cursorAfter(posts, '2', 'order:id'), '3');
  assert.equal(cursorAfter(posts, '', 'order:hot'), '2');
  assert.equal(cursorAfter(posts, '750', 'order:id'), null);
  assert.equal(cursorAfter(posts.slice(0, 159), '', 'order:id'), null);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRatingFilter, completeSearchToken, explicitRating, searchTokenAtCaret } = require('../src/searchQuery.ts');

test('rating picker replaces explicit query rating and can remove it', () => {
  assert.equal(explicitRating('male rating:safe'), 's');
  assert.equal(applyRatingFilter('male rating:safe fox', 'q'), 'male rating:q fox');
  assert.equal(applyRatingFilter('rating:q male', 'all'), 'male');
  assert.equal(applyRatingFilter('male', 'e'), 'male');
});

test('tag completion replaces the token under the caret and preserves the rest of the search', () => {
  assert.deepEqual(searchTokenAtCaret('male fox rating:safe', 6), { start: 5, end: 8, text: 'fox' });
  assert.deepEqual(completeSearchToken('male fox rating:safe', 6, 'foxes'), { query: 'male foxes rating:safe', caret: 10 });
  assert.deepEqual(completeSearchToken('male ca', 7, 'cat'), { query: 'male cat ', caret: 9 });
  assert.equal(searchTokenAtCaret('male  fox', 5), null);
});

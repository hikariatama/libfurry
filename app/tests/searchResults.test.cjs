const test = require('node:test');
const assert = require('node:assert/strict');
const { filterSearchPosts } = require('../src/searchResults.ts');

const post = (id, tags, reacted = false) => ({
  id, width: 100, height: 100, file_ext: 'jpg', file_url: '',
  preview_url: 'https://example.invalid/preview.jpg', preview_webp: null, sample_url: null,
  tags, pools: '', rating: 's', score: 0, fav_count: 0,
  is_favorited: reacted, vote: 0, uploader: null,
});

test('search filtering identifies posts hidden by the blacklist', () => {
  const result = filterSearchPosts([post(1, 'animated'), post(2, 'animated')],
    'rating:safe', [{ text: 'animated', enabled: true }], new Map());
  assert.deepEqual({ available: result.available, blacklisted: result.blacklisted,
    reacted: result.reacted, visible: result.posts.length },
  { available: 2, blacklisted: 2, reacted: 0, visible: 0 });
});

test('search filtering distinguishes reacted posts and explicit favorites query', () => {
  const raw = [post(1, 'canine', true), post(2, 'canine')];
  const normal = filterSearchPosts(raw, 'canine', [], new Map());
  assert.deepEqual(normal.posts.map(item => item.id), [2]);
  assert.equal(normal.reacted, 1);
  const favorites = filterSearchPosts(raw, 'fav:me', [], new Map());
  assert.deepEqual(favorites.posts.map(item => item.id), [1, 2]);
  assert.equal(favorites.reacted, 0);
});

test('search filtering applies local reactions and ignores sample-only posts in the grid', () => {
  const raw = [post(1, 'canine'), { ...post(2, 'canine'), preview_url: null, sample_url: 'https://example.invalid/full.gif' }];
  const result = filterSearchPosts(raw, 'canine', [], new Map([[1, { vote: 1 }]]));
  assert.deepEqual({ available: result.available, reacted: result.reacted, visible: result.posts.length },
    { available: 1, reacted: 1, visible: 0 });
});

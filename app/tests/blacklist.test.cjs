const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBlacklist, allowedPost } = require('../src/blacklist.ts');

test('temporary blacklist toggles retain account rules', () => {
  const rules = parseBlacklist('animated\nfox', ['animated']);
  assert.deepEqual(rules, [
    { text: 'animated', enabled: false },
    { text: 'fox', enabled: true },
  ]);
  const post = { tags: 'animated canid', file_ext: 'mp4', rating: 's', score: 1, fav_count: 0, width: 100, height: 100, id: 1 };
  assert.equal(allowedPost(post, rules), true);
  assert.equal(allowedPost(post, rules.map(rule => ({ ...rule, enabled: true }))), false);
  assert.deepEqual(parseBlacklist('fox', ['animated']), [
    { text: 'fox', enabled: true },
    { text: 'animated', enabled: false },
  ]);
});

const post = { id: 42, tags: 'canine female solo', rating: 'e', file_ext: 'webm', score: 12, fav_count: 5,
  width: 800, height: 600, size: 2 * 1024 * 1024, uploader: 'artist', uploader_id: 123, pools: '7 9',
  flags: 'pending', is_favorited: true, vote: 0 };
const blocks = (rule, changes = {}) => !allowedPost({ ...post, ...changes }, [{ text: rule, enabled: true }]);

test('blacklist combines required and optional terms and ignores comments', () => {
  assert.equal(blocks('canine ~male ~female # either sex'), true);
  assert.equal(blocks('canine ~male ~wolf'), false);
  assert.equal(blocks('canine -female'), false);
  assert.equal(blocks('can* solo'), true);
  assert.equal(blocks('# canine'), false);
  assert.equal(blocks('canine\n# female'), true);
});

test('blacklist matches account metadata and numeric ranges', () => {
  for (const rule of ['rating:explicit', 'type:video', 'type:webm', 'score:10..20', 'favcount:>=5',
    'id:..42', 'filesize:>1mb', 'tagcount:3', 'username:artist', 'userid:123', 'uploader:!123',
    'pool:7', 'status:pending', 'fav:me']) assert.equal(blocks(rule), true, rule);
  for (const rule of ['rating:safe', 'score:10..oops', 'filesize:>3mb', 'uploader:other', 'pool:8'])
    assert.equal(blocks(rule), false, rule);
  assert.equal(blocks('pool:9', { pools: '7; 9' }), true);
});

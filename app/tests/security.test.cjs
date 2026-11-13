const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fetchAllowed, readText, allowedMediaURL, MEDIA_BYTES } = require('../electron/services/network.cjs');
const { CacheStorage } = require('../electron/services/cache-storage.cjs');
const { validateSettings, defaults, MAX_STRING, MAX_IDS_PER_TAG } = require('../electron/services/settings.cjs');
const { installPermissions } = require('../electron/services/permissions.cjs');

test('redirects are checked before connecting and account mutations are not redirected', async () => {
  const original = global.fetch;
  const seen = [];
  try {
    global.fetch = async (url, options) => {
      seen.push(String(url));
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 307, headers: { location: 'https://127.0.0.1/private' } });
    };
    await assert.rejects(fetchAllowed('https://e621.net/posts.json'), /untrusted/);
    await assert.rejects(fetchAllowed('https://static1.e621.net/data/a.jpg', {}, true), /untrusted/);
    assert.equal(seen.length, 2);
    global.fetch = async () => new Response(null, { status: 307, headers: { location: '/favorites.json' } });
    await assert.rejects(fetchAllowed('https://e621.net/favorites.json', { method: 'POST', body: 'post_id=1' }), /account actions/);
  } finally { global.fetch = original; }
});

test('relative API redirects and reviewed media hosts work, loops stop after five hops', async () => {
  const original = global.fetch;
  try {
    let requests = 0;
    global.fetch = async () => ++requests === 1
      ? new Response(null, { status: 302, headers: { location: '/posts.json' } }) : new Response('ok');
    assert.equal(await (await fetchAllowed('https://e621.net/old.json')).text(), 'ok');
    requests = 0;
    global.fetch = async () => { requests++; return new Response(null, { status: 302, headers: { location: '/loop' } }); };
    await assert.rejects(fetchAllowed('https://e621.net/loop'), /redirects/);
    assert.equal(requests, 6);
    assert.equal(allowedMediaURL('https://static2.e926.net/data/a.webm'), true);
    for (const url of ['http://e621.net/data/a', 'https://e621.net:8443/data/a', 'https://evil.e621.net/data/a', 'https://static1.e621.net/other/a']) {
      assert.equal(allowedMediaURL(url), false);
    }
  } finally { global.fetch = original; }
});

test('API response limits apply to declared and actual streamed bytes', async () => {
  let cancelled = false;
  const stream = () => new ReadableStream({
    pull(controller) { controller.enqueue(Buffer.alloc(4)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readText(new Response(stream(), { headers: { 'content-length': '100' } }), 8), /size limit/);
  assert.equal(cancelled, true);
  cancelled = false;
  await assert.rejects(readText(new Response(stream()), 8), /size limit/);
  assert.equal(cancelled, true);
  assert.equal(await readText(new Response('12345678'), 8), '12345678');
  assert.equal(MEDIA_BYTES, 16 * 1024 ** 3);
});

test('settings preserve large unread lists and reject invalid nested state without truncation', () => {
  const settings = defaults();
  settings.watched = [{ name: 'fox', seen: [], unseen: Array.from({ length: 100000 }, (_, id) => id + 1), checkpoint: 100000 }];
  assert.equal(validateSettings(settings), settings);
  assert.equal(settings.watched[0].unseen.length, 100000);
  assert.throws(() => validateSettings({ ...settings, disabledBlacklist: ['x'.repeat(MAX_STRING + 1)] }), /settings/);
  assert.throws(() => validateSettings({ ...settings, watched: [{ name: 'fox', seen: [], unseen: [-1] }] }), /settings/);
  assert.throws(() => validateSettings({ ...settings, watched: [{ name: 'fox', seen: [], unseen: new Array(MAX_IDS_PER_TAG + 1) }] }), /settings/);
  assert.throws(() => validateSettings({ ...settings, unexpected: {} }), /settings/);
  assert.throws(() => validateSettings({ ...settings, watched: [{ name: 'fox', seen: [], unseen: new Array(1) }] }), /settings/);
});

test('cache admission preserves pinned snapshots and evicts only expendable data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'libfurry-cache-budget-'));
  const pinned = new Set(['a']);
  const cache = new CacheStorage(root, () => pinned, { maxBytes: 12, maxFiles: 5, maxEntryBytes: 8 });
  try {
    const snapshot = path.join(root, 'page-snapshots', 'a.json');
    const expendable = path.join(root, 'search-cache', 'b.json');
    await cache.write(snapshot, '12345678');
    await cache.write(expendable, '1234');
    await assert.rejects(cache.write(path.join(root, 'page-snapshots', 'c.json'), '12345678'), /preserved/);
    assert.equal(await cache.read(snapshot), '12345678');
    await cache.write(expendable, '5678');
    assert.equal(await cache.read(expendable), '5678');
    await assert.rejects(cache.write(expendable, '123456789'), /entry/);
    pinned.clear();
    await cache.write(path.join(root, 'page-snapshots', 'c.json'), '12345678');
    await assert.rejects(fs.access(snapshot), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Chromium permissions deny unused capabilities and allow only main-file fullscreen', () => {
  const handlers = {};
  const contents = {};
  const file = path.join(os.tmpdir(), 'app', 'dist', 'index.html');
  installPermissions({
    setPermissionCheckHandler: callback => { handlers.check = callback; },
    setPermissionRequestHandler: callback => { handlers.request = callback; },
    setDevicePermissionHandler: callback => { handlers.device = callback; },
  }, contents, file);
  const details = { isMainFrame: true, requestingUrl: pathToFileURL(file).href };
  assert.equal(handlers.check(contents, 'fullscreen', '', details), true);
  for (const permission of ['media', 'display-capture', 'clipboard-read', 'notifications', 'hid', 'automatic-fullscreen', 'unknown']) {
    assert.equal(handlers.check(contents, permission, '', details), false);
    handlers.request(contents, permission, result => assert.equal(result, false), details);
  }
  assert.equal(handlers.check(contents, 'fullscreen', '', { ...details, isMainFrame: false }), false);
  assert.equal(handlers.check({}, 'fullscreen', '', details), false);
  assert.equal(handlers.check(contents, 'fullscreen', '', { ...details, requestingUrl: 'http://127.0.0.1:5173/' }), false);
  assert.equal(handlers.device(), false);
});


test('cache writes have bounded admission and release capacity after completion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'libfurry-cache-queue-'));
  try {
    const cache = new CacheStorage(root, () => new Set(), { maxPendingWrites: 1 });
    const destination = path.join(root, 'search-cache', 'test.json');
    const first = cache.write(destination, '[]');
    await assert.rejects(cache.write(destination, '[]'), /queue is full/);
    await first;
    await cache.write(destination, '[1]');
    assert.equal(await cache.read(destination), '[1]');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

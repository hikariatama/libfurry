const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { captureSearchSession, discardResumedReactions, resumeSearchSession } = require('../src/searchSession.ts');
const { normalizeSession, SearchSessionStore } = require('../electron/services/search-session.cjs');

function sessionAt(pageCount = 1) {
  const pages = Array.from({ length: pageCount }, (_, page) => ({
    cursor: page ? String(page + 1) : '', snapshotKey: (page + 1).toString(16).padStart(64, '0'),
    slots: Array.from({ length: 160 }, (_, index) => ({ id: 100000 - page * 160 - index, ratio: 0.5 + index % 3, reacted: false })),
    posts: page % 2 ? null : [{ id: 100000 - page * 160, tags: 'synthetic', preview_url: 'not persisted in the session' }],
  }));
  return captureSearchSession({
    query: 'fox order:hot', draft: 'fox order:hot -cat ', rating: 's', accountId: 42,
    nextCursor: String(pageCount + 1), anchor: { id: pages.at(-1).slots[45].id, offset: -17.25 },
    counts: { raw: pageCount * 160, available: pageCount * 160, blacklisted: 0, reacted: 0 },
  }, pages, new Map([[100000, { vote: 1, is_favorited: true }]]));
}

function storageIn(root) {
  const electronModule = require.resolve('electron');
  require.cache[electronModule] = {
    id: electronModule, filename: electronModule, loaded: true,
    exports: { app: { getPath: () => root }, safeStorage: {} },
  };
  const modulePath = require.resolve('../electron/services/storage.cjs');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('a new process restores a long search, pending input and exact scroll anchor from disk', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-session-'));
  try {
    const storage = storageIn(root);
    const firstProcess = new SearchSessionStore(storage);
    await firstProcess.load();
    const saved = sessionAt(40);
    await firstProcess.write(saved);
    const secondProcess = new SearchSessionStore(storage);
    const loaded = await secondProcess.load();
    assert.deepEqual(loaded.value, saved);
    const resumed = resumeSearchSession(loaded.value);
    assert.equal(resumed.pages.length, 40);
    assert.equal(resumed.ids.size, 6400);
    assert.deepEqual(resumed.anchor, saved.anchor);
    assert.ok(resumed.ids.has(resumed.anchor.id));
    assert.ok(resumed.pages.every(page => page.posts === null));
    assert.deepEqual(resumed.reactions.get(100000), { vote: 1, is_favorited: true });
    assert.deepEqual(Object.keys(saved.pages[0]).sort(), ['cursor', 'slots', 'snapshotKey']);
    assert.deepEqual((await fs.readdir(root)).sort(), ['session.json']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('new searches and returning to the top replace the previous saved position', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-session-top-'));
  try {
    const store = new SearchSessionStore(storageIn(root));
    await store.load();
    await store.write(sessionAt(8));
    const atTop = { ...sessionAt(8), anchor: { id: 100000, offset: 48 } };
    await store.write(atTop);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'session.json'), 'utf8')).anchor, atTop.anchor);
    const searching = { ...sessionAt(), query: 'wolf', draft: 'wolf', pages: [], nextCursor: '', anchor: null, reactions: [],
      counts: { raw: 0, available: 0, blacklisted: 0, reacted: 0 } };
    await store.write(searching);
    assert.deepEqual((await new SearchSessionStore(storageIn(root)).load()).value, searching);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('resuming under another verified account never carries over local reactions', () => {
  const session = sessionAt();
  assert.equal(resumeSearchSession(session, 42).reactions.size, 1);
  assert.equal(resumeSearchSession(session).reactions.size, 1);
  assert.equal(resumeSearchSession(session, 99).reactions.size, 0);
  assert.equal(resumeSearchSession(session, null).reactions.size, 0);
  const searching = captureSearchSession({ ...session, query: 'wolf', anchor: session.anchor }, [], new Map());
  assert.equal(searching.anchor, null);
  assert.deepEqual(searching.pages, []);
});

test('saved reactions hydrate cached posts but cannot override fresh server data or newer actions', () => {
  const restored = resumeSearchSession(sessionAt());
  const current = new Map(restored.reactions);
  current.set(99999, { vote: 1 });
  const fresh = discardResumedReactions(current, restored.reactions);
  assert.equal(fresh.has(100000), false);
  assert.deepEqual(fresh.get(99999), { vote: 1 });
  current.set(100000, { is_favorited: false });
  assert.deepEqual(discardResumedReactions(current, restored.reactions).get(100000), { is_favorited: false });
});

test('queued writes flush in order and snapshot the payload before the caller mutates it', async () => {
  const writes = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const store = new SearchSessionStore({
    async saveJSON(_name, value) { if (!writes.length) await gate; writes.push(value); },
  });
  const first = sessionAt();
  const write1 = store.write(first);
  const second = { ...sessionAt(3), draft: 'latest input' };
  const write2 = store.write(second);
  first.pages[0].slots[0].id = 1;
  let flushed = false;
  const flush = store.flush().then(() => { flushed = true; });
  await new Promise(setImmediate);
  assert.equal(flushed, false);
  release();
  await Promise.all([write1, write2, flush]);
  assert.equal(writes[0].pages[0].slots[0].id, 100000);
  assert.equal(writes[1].draft, 'latest input');
  assert.deepEqual(store.value, second);
});

test('damaged sessions are preserved and a later valid checkpoint can be saved', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-session-damaged-'));
  try {
    await fs.writeFile(path.join(root, 'session.json'), '{broken');
    const store = new SearchSessionStore(storageIn(root));
    const loaded = await store.load();
    assert.equal(loaded.value, null);
    assert.equal(loaded.writable, true);
    assert.match(loaded.issue, /session.json/);
    const backup = (await fs.readdir(root)).find(name => name.startsWith('session.json.damaged-'));
    assert.equal(await fs.readFile(path.join(root, backup), 'utf8'), '{broken');
    await store.write(sessionAt());
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'session.json'), 'utf8')).query, 'fox order:hot');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('read-only recovery and failed writes never pretend to have persisted a session', async () => {
  let writes = 0;
  const store = new SearchSessionStore({
    recoverJSON: async () => ({ value: null, writable: false, issue: 'Cannot preserve original' }),
    saveJSON: async () => { writes++; },
  });
  await store.load();
  await assert.rejects(store.write(sessionAt()), /read-only/);
  assert.equal(writes, 0);
  const retryable = new SearchSessionStore({ saveJSON: async () => { if (!writes++) throw new Error('disk full'); } });
  await assert.rejects(retryable.write(sessionAt()), /disk full/);
  assert.equal(retryable.value, null);
  await retryable.write(sessionAt(2));
  assert.equal(retryable.value.pages.length, 2);
});

test('invalid sessions cannot supply paths, duplicate IDs or non-finite geometry', () => {
  for (const change of [
    value => { value.version = 2; },
    value => { value.pages[0].snapshotKey = '../credentials.bin'; },
    value => { value.pages[0].slots[0].ratio = NaN; },
    value => { value.pages[0].slots[1].id = value.pages[0].slots[0].id; },
    value => { value.anchor.id = 7; },
    value => { value.nextCursor = '../../elsewhere'; },
    value => { value.reactions[0].vote = 9; },
  ]) {
    const value = sessionAt(); change(value);
    assert.throws(() => normalizeSession(value));
  }
  const value = sessionAt();
  value.apiKey = 'must not persist';
  value.pages[0].posts = [{ private: 'must not persist' }];
  const normalized = normalizeSession(value);
  assert.equal(normalized.apiKey, undefined);
  assert.equal(normalized.pages[0].posts, undefined);
});

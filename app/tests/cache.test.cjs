const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function clientFor(root) {
  const storageModule = require.resolve('../electron/services/storage.cjs');
  const apiModule = require.resolve('../electron/services/e621.cjs');
  require.cache[storageModule] = {
    id: storageModule,
    filename: storageModule,
    loaded: true,
    exports: { dataPath: relative => path.join(root, relative) },
  };
  delete require.cache[apiModule];
  const { E621Client } = require('../electron/services/e621.cjs');
  return new E621Client();
}

test('page snapshots remain exact after a search refresh and caches are account scoped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-cache-'));
  try {
    const client = clientFor(root);
    const guestCache = client.cachePath('male', '');
    client.setCredentials({ username: 'SampleUser', apiKey: 'test-only' });
    assert.notEqual(client.cachePath('male', ''), guestCache);
    client.setCredentials(null);
    let posts = [{ id: 10, preview_url: 'https://static1.e621.net/data/first.jpg' }];
    client.request = async () => new Response(JSON.stringify(posts), { status: 200, headers: { etag: '"one"' } });
    const first = await client.search('male');
    posts = [{ id: 11, preview_url: 'https://static1.e621.net/data/second.jpg' }];
    const second = await client.search('male', '', true);
    assert.notEqual(first.snapshotKey, second.snapshotKey);
    assert.deepEqual((await client.snapshotPage(first.snapshotKey)).posts.map(post => post.id), [10]);
    assert.deepEqual((await client.snapshotPage(second.snapshotKey)).posts.map(post => post.id), [11]);
    assert.deepEqual((await client.cachedSearch('male', '')).posts.map(post => post.id), [11]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a missing or damaged page snapshot is restored from the search cache', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-restore-page-'));
  try {
    const client = clientFor(root);
    client.request = async () => new Response(JSON.stringify([{ id: 73, width: 100, height: 100 }]), { status: 200 });
    const first = await client.search('fox');
    const filename = path.join(root, 'page-snapshots', `${first.snapshotKey}.json`);
    await fs.rm(filename);
    assert.deepEqual((await client.restorePage(first.snapshotKey, 'fox', '')).posts.map(post => post.id), [73]);
    await fs.writeFile(filename, '{bad json');
    assert.deepEqual((await client.restorePage(first.snapshotKey, 'fox', '')).posts.map(post => post.id), [73]);
    await fs.writeFile(filename, '[{"id":74}]');
    assert.deepEqual((await client.restorePage(first.snapshotKey, 'fox', '')).posts.map(post => post.id), [73]);
    assert.deepEqual((await client.snapshotPage(first.snapshotKey)).posts.map(post => post.id), [73]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('cache maintenance preserves snapshots pinned by the open gallery', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-pinned-snapshot-'));
  const key = 'a'.repeat(64);
  try {
    await fs.mkdir(path.join(root, 'search-cache'));
    await fs.mkdir(path.join(root, 'page-snapshots'));
    const filename = path.join(root, 'page-snapshots', `${key}.json`);
    await fs.writeFile(filename, '[]');
    const old = new Date(Date.now() - 40 * 86400_000);
    await fs.utimes(filename, old, old);
    const client = clientFor(root);
    client.pinSnapshots([key]);
    await client.pruneCache();
    await fs.access(filename);
    client.pinSnapshots([]);
    client.lastCachePrune = 0;
    await client.pruneCache();
    await assert.rejects(fs.access(filename), error => error.code === 'ENOENT');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the saved session protects old snapshots even after the active gallery releases them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-session-pinned-'));
  const key = 'b'.repeat(64);
  try {
    await fs.mkdir(path.join(root, 'search-cache'));
    await fs.mkdir(path.join(root, 'page-snapshots'));
    const file = path.join(root, 'page-snapshots', `${key}.json`);
    await fs.writeFile(file, '[]');
    const old = new Date(Date.now() - 40 * 86400_000);
    await fs.utimes(file, old, old);
    const client = clientFor(root);
    client.pinPersistedSnapshots([key]);
    client.pinSnapshots([]);
    await client.pruneCache();
    await fs.access(file);
    client.pinPersistedSnapshots([]);
    client.lastCachePrune = 0;
    await client.pruneCache();
    await assert.rejects(fs.access(file), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a missing old snapshot is never silently replaced with a changed search page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-changed-page-'));
  try {
    const client = clientFor(root);
    let posts = [{ id: 73, width: 100, height: 100 }];
    client.request = async () => new Response(JSON.stringify(posts), { status: 200 });
    const original = await client.search('fox');
    posts = [{ id: 72, width: 100, height: 100 }];
    await client.search('fox', '', true);
    await fs.rm(path.join(root, 'page-snapshots', `${original.snapshotKey}.json`));
    await assert.rejects(client.restorePage(original.snapshotKey, 'fox', ''), /Page snapshot was lost/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('authenticated searches fetch fresh reaction flags instead of reusing a page ETag', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-auth-cache-'));
  try {
    const client = clientFor(root);
    client.setCredentials({ username: 'SampleUser', apiKey: 'test-only' });
    const headers = [];
    client.request = async (_route, options) => {
      headers.push(options.headers);
      return new Response(JSON.stringify([{ id: 10, vote: headers.length - 1, is_favorited: headers.length > 1 }]),
        { status: 200, headers: { etag: '"unchanged"' } });
    };
    await client.search('wolf');
    const second = await client.search('wolf');
    assert.deepEqual(headers, [{}, {}]);
    assert.equal(second.posts[0].is_favorited, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('cached search does not hide authentication or query errors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-search-errors-'));
  try {
    const client = clientFor(root);
    client.request = async () => new Response(JSON.stringify([{ id: 10 }]), { status: 200 });
    await client.search('fox');
    for (const status of [401, 403, 422]) {
      client.request = async () => { throw new Error(`e621: ${status} rejected`); };
      await assert.rejects(client.search('fox'), new RegExp(`e621: ${status}`));
    }
    client.request = async () => { throw new Error('e621: 503 unavailable'); };
    const cached = await client.search('fox');
    assert.equal(cached.fromCache, true);
    assert.deepEqual(cached.posts.map(post => post.id), [10]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('cache cannot conceal a failed snapshot write or malformed API response', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-search-storage-'));
  try {
    const client = clientFor(root);
    client.request = async () => new Response(JSON.stringify([{ id: 10 }]), { status: 200 });
    await client.search('fox');
    client.request = async () => new Response(JSON.stringify({ error: 'unexpected shape' }), { status: 200 });
    await assert.rejects(client.search('fox'), /Invalid e621 response/);
    client.request = async () => new Response(JSON.stringify([{ id: 11 }]), { status: 200 });
    client.saveSnapshot = async () => { throw new Error('ENOSPC'); };
    await assert.rejects(client.search('fox'), /ENOSPC/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an account change during a search keeps its response in the original account cache', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-account-race-'));
  try {
    const client = clientFor(root);
    const first = { username: 'FirstUser', apiKey: 'test-first' };
    const second = { username: 'SecondUser', apiKey: 'test-second' };
    client.setCredentials(first);
    let release;
    let started;
    const requestStarted = new Promise(resolve => { started = resolve; });
    client.request = async (_route, options) => {
      started(options.auth);
      await new Promise(resolve => { release = resolve; });
      return new Response(JSON.stringify([{ id: 101, vote: 1 }]));
    };
    const pending = client.search('fox');
    assert.deepEqual(await requestStarted, first);
    client.setCredentials(second);
    release();
    await pending;
    assert.deepEqual((await client.cachedSearch('fox', '', 'firstuser')).posts.map(post => post.id), [101]);
    assert.equal(await client.cachedSearch('fox', '', 'seconduser'), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an existing upvote is accepted only after confirming it remains on the post', async () => {
  const client = clientFor(os.tmpdir());
  const routes = [];
  client.request = async route => {
    routes.push(route);
    return new Response(JSON.stringify(routes.length === 1 ? { our_score: 0 } : { post: { vote: 1 } }));
  };
  await client.upvote(42);
  assert.deepEqual(routes, ['/posts/42/votes.json?score=1&no_unvote=true', '/posts/42.json']);

  client.request = async route => new Response(JSON.stringify(route.includes('/votes.json') ? { our_score: 0 } : { post: { vote: 0 } }));
  await assert.rejects(client.upvote(42), /did not confirm the upvote/);
});

test('upvote confirmation uses the account that sent the vote', async () => {
  const client = clientFor(os.tmpdir());
  const first = { username: 'first', apiKey: 'first-key' };
  const second = { username: 'second', apiKey: 'second-key' };
  client.setCredentials(first);
  const auths = [];
  client.request = async (route, options) => {
    auths.push(options.auth);
    if (route.includes('/votes.json')) {
      client.setCredentials(second);
      return new Response(JSON.stringify({ our_score: 0 }));
    }
    return new Response(JSON.stringify({ post: { vote: 1 } }));
  };
  await client.upvote(42);
  assert.deepEqual(auths, [first, first]);
});

test('favorite confirmation uses the account that sent the request', async () => {
  const client = clientFor(os.tmpdir());
  const first = { username: 'first', apiKey: 'first-key' };
  const second = { username: 'second', apiKey: 'second-key' };
  client.setCredentials(first);
  const auths = [];
  client.request = async (route, options) => {
    auths.push(options.auth);
    if (route === '/favorites.json') {
      client.setCredentials(second);
      throw new Error('e621: 422 already favorited');
    }
    return new Response(JSON.stringify({ post: { is_favorited: true } }));
  };
  await client.favorite(42);
  assert.deepEqual(auths, [first, first]);
});

test('a favorite validation error succeeds only when the post is already favorited', async () => {
  const client = clientFor(os.tmpdir());
  client.request = async route => {
    if (route === '/favorites.json') throw new Error('e621: 422 already favorited');
    return new Response(JSON.stringify({ post: { is_favorited: true } }));
  };
  await client.favorite(42);
  client.request = async route => {
    if (route === '/favorites.json') throw new Error('e621: 422 favorite limit reached');
    return new Response(JSON.stringify({ post: { is_favorited: false } }));
  };
  await assert.rejects(client.favorite(42), /favorite limit reached/);
});

test('parallel refreshes use separate temporary cache files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-parallel-cache-'));
  const originalRename = fs.rename;
  const temporaryPaths = [];
  let releaseRenames;
  const bothReady = new Promise(resolve => { releaseRenames = resolve; });
  try {
    const client = clientFor(root);
    client.request = async () => new Response(JSON.stringify([{ id: 20 }]), { status: 200 });
    fs.rename = async (source, destination) => {
      if (source.includes(`${path.sep}search-cache${path.sep}`)) {
        temporaryPaths.push(source);
        if (temporaryPaths.length === 2) releaseRenames();
        await bothReady;
      }
      return originalRename(source, destination);
    };
    const results = await Promise.all([client.search('fox'), client.search('fox')]);
    assert.equal(results.length, 2);
    assert.equal(new Set(temporaryPaths).size, 2);
    assert.deepEqual((await fs.readdir(path.join(root, 'search-cache'))).filter(name => name.endsWith('.tmp')), []);
  } finally {
    releaseRenames();
    fs.rename = originalRename;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('tag suggestions use prefix search rather than related tags', async () => {
  const client = clientFor(os.tmpdir());
  let requested = '';
  client.request = async route => {
    requested = route;
    return new Response(JSON.stringify([{ id: 1, name: 'male' }, { id: 2, name: 'male/male' }]));
  };
  const tags = await client.autocomplete('male');
  const url = new URL(requested, 'https://e621.net');
  assert.equal(url.pathname, '/tags.json');
  assert.equal(url.searchParams.get('search[name_matches]'), 'male*');
  assert.equal(url.searchParams.get('search[order]'), 'count');
  assert.deepEqual(tags.map(tag => tag.name), ['male', 'male/male']);
});

test('repeated tag prefixes reuse suggestions without another API request', async () => {
  const client = clientFor(os.tmpdir());
  let requests = 0;
  client.request = async () => {
    requests++;
    return new Response(JSON.stringify([{ id: 70, name: 'fox' }]));
  };
  assert.deepEqual((await client.autocomplete('Fo')).map(tag => tag.name), ['fox']);
  assert.deepEqual((await client.autocomplete('fo')).map(tag => tag.name), ['fox']);
  assert.equal(requests, 1);
  client.autocompleteCache.get('fo').expiresAt = 0;
  await client.autocomplete('fo');
  assert.equal(requests, 2);
});

test('a submitted search cancels an unfinished tag lookup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-search-priority-'));
  try {
    const client = clientFor(root);
    let lookupSignal;
    client.request = async (route, options = {}) => {
      if (route.startsWith('/tags.json')) {
        lookupSignal = options.signal;
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      }
      return new Response(JSON.stringify([{ id: 42 }]), { status: 200 });
    };
    const lookup = client.autocomplete('male');
    const rejected = assert.rejects(lookup, /aborted/);
    await Promise.resolve();
    const result = await client.search('rating:safe male');
    await rejected;
    assert.equal(lookupSignal.aborted, true);
    assert.deepEqual(result.posts.map(post => post.id), [42]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a timed out request releases the serial API queue', async () => {
  const client = clientFor(os.tmpdir());
  client.nextRequest = 0;
  const originalFetch = global.fetch;
  // Real fetch keeps a socket alive; this stub must keep the timeout observable too.
  const keepAlive = setInterval(() => {}, 1000);
  let calls = 0;
  try {
    global.fetch = (_url, { signal }) => {
      calls += 1;
      if (calls === 1) return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    const first = client.request('/tags.json', { timeoutMs: 10 });
    const second = client.request('/posts.json', { timeoutMs: 100 });
    await assert.rejects(first, error => error.name === 'TimeoutError');
    assert.equal((await second).status, 200);
    assert.equal(calls, 2);
  } finally {
    clearInterval(keepAlive);
    global.fetch = originalFetch;
  }
});

test('cancelled search does not return a stale cached page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-cancel-search-'));
  try {
    const client = clientFor(root);
    client.request = async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
    await client.search('wolf');
    let started;
    const requestStarted = new Promise(resolve => { started = resolve; });
    client.request = async (_route, { signal }) => {
      started();
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    };
    const controller = new AbortController();
    const search = client.search('wolf', '', true, controller.signal);
    await requestStarted;
    controller.abort();
    await assert.rejects(search, error => error.name === 'AbortError');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

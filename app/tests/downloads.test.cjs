const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Downloads } = require('../electron/services/downloads.cjs');

test('cancelling while post details load stops the job', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-detail-cancel-'));
  let detailsStarted;
  const started = new Promise(resolve => { detailsStarted = resolve; });
  let finished;
  const cancelled = new Promise(resolve => { finished = resolve; });
  try {
    const api = { detail: async (_id, signal) => {
      detailsStarted();
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } };
    const downloads = new Downloads(api, job => { if (job.status === 'cancelled') finished(job); });
    const id = downloads.start({ id: 12 }, folder, false);
    await started;
    downloads.cancel(id);
    assert.equal((await cancelled).status, 'cancelled');
    assert.deepEqual(await fs.readdir(folder), []);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('cancelling a running download removes its partial file', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-download-test-'));
  const originalFetch = global.fetch;
  let releaseNextChunk;
  const nextChunk = new Promise(resolve => { releaseNextChunk = resolve; });
  let firstChunkWritten;
  const firstChunk = new Promise(resolve => { firstChunkWritten = resolve; });
  const events = [];
  try {
    global.fetch = async () => ({
      ok: true,
      headers: new Headers({ 'content-length': '8192' }),
      body: (async function* () {
        yield Buffer.alloc(4096, 1);
        await nextChunk;
        yield Buffer.alloc(4096, 2);
      })(),
    });
    const api = { detail: async id => ({
      id, file: { url: 'https://static1.e621.net/data/example.jpg', ext: 'jpg' },
      tags: { artist: ['test_artist'], species: ['canid'] }, uploader: 'tester',
    }) };
    const downloads = new Downloads(api, job => {
      events.push(job);
      if (job.fraction > 0 && job.status === 'running') firstChunkWritten();
    });
    const id = downloads.start({ id: 123 }, folder, false);
    await firstChunk;
    assert.equal((await fs.readdir(folder)).some(name => name.endsWith('.part')), true);
    downloads.cancel(id);
    releaseNextChunk();
    await Promise.race([
      new Promise(resolve => {
        const check = () => events.at(-1)?.status === 'cancelled' ? resolve() : setTimeout(check, 5);
        check();
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Download did not cancel')), 2000)),
    ]);
    assert.deepEqual(await fs.readdir(folder), []);
  } finally {
    releaseNextChunk();
    global.fetch = originalFetch;
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('combined action reports each result even if saving fails', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-combined-test-'));
  const originalFetch = global.fetch;
  const actions = [];
  let finished;
  const completion = new Promise(resolve => { finished = resolve; });
  try {
    global.fetch = async () => { throw new Error('Network unavailable'); };
    const api = {
      detail: async id => ({ id, file: { url: 'https://static1.e621.net/data/example.jpg', ext: 'jpg' }, tags: {}, uploader: 'tester' }),
      upvote: async () => { actions.push('upvote'); },
      favorite: async () => { actions.push('favorite'); },
    };
    const downloads = new Downloads(api, job => { if (job.status === 'failed') finished(job); });
    downloads.start({ id: 456 }, folder, true);
    const job = await Promise.race([
      completion,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Combined action did not finish')), 2000)),
    ]);
    assert.deepEqual(actions, ['upvote', 'favorite']);
    assert.deepEqual(job.result, ['Download: Network unavailable', 'Upvoted', 'Favorited']);
    assert.equal(job.status, 'failed');
    assert.deepEqual(await fs.readdir(folder), []);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('Save + upgrades an in-progress plain download instead of losing account actions', async () => {
  let releaseSave;
  let saveStarted;
  let finished;
  const started = new Promise(resolve => { saveStarted = resolve; });
  const saved = new Promise(resolve => { releaseSave = resolve; });
  const completed = new Promise(resolve => { finished = resolve; });
  const actions = [];
  const downloads = new Downloads({
    upvote: async id => { actions.push(`upvote:${id}`); },
    favorite: async id => { actions.push(`favorite:${id}`); },
  }, job => { if (job.status === 'complete') finished(job); });
  downloads.save = async () => { saveStarted(); await saved; };
  const first = downloads.start({ id: 456 }, '/downloads', false);
  await started;
  const second = downloads.start({ id: 456 }, '/downloads', true, 'account', 7);
  assert.equal(second, first);
  assert.equal(downloads.list()[0].combined, true);
  assert.equal(downloads.list()[0].accountRevision, 7);
  releaseSave();
  const result = await completed;
  assert.deepEqual(actions, ['upvote:456', 'favorite:456']);
  assert.deepEqual(result.result, ['Upvoted', 'Favorited']);
});

test('a plain save after switching accounts does not inherit an old Save + job', async () => {
  let releaseFirst;
  let firstStarted;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const started = new Promise(resolve => { firstStarted = resolve; });
  let account = 'first';
  const downloads = new Downloads({ upvote: async () => {}, favorite: async () => {} }, () => {}, token => token === account);
  downloads.save = async job => {
    if (job.combined) { firstStarted(); await firstGate; }
  };
  const combined = downloads.start({ id: 456 }, '/downloads', true, 'first', 1);
  await started;
  account = 'second';
  const plain = downloads.start({ id: 456 }, '/downloads', false);
  assert.notEqual(plain, combined);
  assert.equal(downloads.jobs.get(plain).combined, false);
  releaseFirst();
  await new Promise(resolve => setImmediate(resolve));
});

test('the same post can be saved to a newly selected folder while an earlier download runs', async () => {
  const savedFolders = [];
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const downloads = new Downloads({}, job => {
    if (job.status === 'complete' && savedFolders.length === 2) finish();
  });
  downloads.save = async job => { savedFolders.push(job.folder); };
  const first = downloads.start({ id: 456 }, '/first', false);
  const second = downloads.start({ id: 456 }, '/second', false);
  await completed;
  assert.notEqual(first, second);
  assert.deepEqual(savedFolders, ['/first', '/second']);
});

test('a new download is not swallowed by an already cancelled running job', async () => {
  let finished;
  const completed = new Promise(resolve => { finished = resolve; });
  const downloads = new Downloads({}, job => {
    if (job.status === 'complete') finished(job);
  });
  let attempts = 0;
  downloads.save = async job => {
    attempts++;
    if (attempts === 1) await new Promise(resolve => job.controller.signal.addEventListener('abort', resolve, { once: true }));
  };
  const first = downloads.start({ id: 456 }, '/downloads', false);
  downloads.cancel(first);
  const second = downloads.start({ id: 456 }, '/downloads', false);
  assert.notEqual(second, first);
  assert.equal((await completed).id, second);
  assert.equal(attempts, 2);
});

test('cancelling Save + after an upvote preserves that action in its result', async () => {
  let beginVote;
  let releaseVote;
  let cancelled;
  const voteStarted = new Promise(resolve => { beginVote = resolve; });
  const voteGate = new Promise(resolve => { releaseVote = resolve; });
  const stopped = new Promise(resolve => { cancelled = resolve; });
  let favorites = 0;
  const downloads = new Downloads({
    upvote: async () => { beginVote(); await voteGate; },
    favorite: async () => { favorites++; },
  }, job => { if (job.status === 'cancelled') cancelled(job); });
  downloads.save = async () => {};
  const id = downloads.start({ id: 456 }, '/downloads', true);
  await voteStarted;
  downloads.cancel(id);
  releaseVote();
  const result = await stopped;
  assert.deepEqual(result.result, ['Upvoted']);
  assert.equal(favorites, 0);
});

test('successful repeat download keeps one complete original and no partial files', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-dedup-test-'));
  const originalFetch = global.fetch;
  let fetchCount = 0;
  try {
    global.fetch = async () => {
      fetchCount++;
      return new Response(Buffer.from('complete-image'), { status: 200 });
    };
    const api = { detail: async id => ({
      id, file: { url: 'https://static1.e621.net/data/example.jpg', ext: 'jpg', size: Buffer.byteLength('complete-image') },
      tags: { artist: ['artist'], species: ['fox'] }, uploader: 'tester',
    }) };
    let completed;
    const done = () => new Promise(resolve => { completed = resolve; });
    const downloads = new Downloads(api, job => { if (job.status === 'complete') completed(job); });
    const first = done();
    downloads.start({ id: 789 }, folder, false);
    assert.deepEqual((await first).result, ['Saved']);
    const second = done();
    downloads.start({ id: 789 }, folder, false);
    assert.deepEqual((await second).result, ['Already saved']);
    const files = await fs.readdir(folder);
    assert.equal(files.length, 1);
    assert.match(files[0], /_e621_789\.jpg$/);
    assert.equal(await fs.readFile(path.join(folder, files[0]), 'utf8'), 'complete-image');
    assert.equal(fetchCount, 1);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('download checks the original hash and rejects a same-size damaged duplicate', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-hash-test-'));
  const originalFetch = global.fetch;
  const content = Buffer.from('complete-image');
  const md5 = createHash('md5').update(content).digest('hex');
  let finished;
  const result = () => new Promise(resolve => { finished = resolve; });
  try {
    global.fetch = async () => new Response(content, { status: 200 });
    const api = { detail: async id => ({
      id, file: { url: 'https://static1.e621.net/data/example.jpg', ext: 'jpg', size: content.length, md5 },
      tags: {}, uploader: 'tester',
    }) };
    const downloads = new Downloads(api, job => { if (['complete', 'failed'].includes(job.status)) finished(job); });
    const first = result();
    downloads.start({ id: 42 }, folder, false);
    assert.equal((await first).status, 'complete');
    const filename = path.join(folder, (await fs.readdir(folder))[0]);
    await fs.writeFile(filename, Buffer.alloc(content.length, 0));
    const second = result();
    downloads.start({ id: 42 }, folder, false);
    assert.match((await second).result[0], /damaged/);
    assert.notDeepEqual(await fs.readFile(filename), content);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('downloaded bytes with the wrong hash never become an original', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-wrong-hash-'));
  const originalFetch = global.fetch;
  let finished;
  const result = new Promise(resolve => { finished = resolve; });
  try {
    global.fetch = async () => new Response(Buffer.from('bad'), { status: 200 });
    const api = { detail: async id => ({
      id, file: { url: 'https://static1.e621.net/data/example.jpg', ext: 'jpg', size: 3, md5: createHash('md5').update('good').digest('hex') },
      tags: {}, uploader: 'tester',
    }) };
    const downloads = new Downloads(api, job => { if (job.status === 'failed') finished(job); });
    downloads.start({ id: 43 }, folder, false);
    assert.match((await result).result[0], /checksum/);
    assert.deepEqual(await fs.readdir(folder), []);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('startup cleanup removes only abandoned e322 partial downloads', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-orphans-'));
  try {
    const abandoned = '.artist_fox_e621_42.jpg.00000000-0000-4000-8000-000000000000.part';
    const unrelated = 'my-video.part';
    await fs.writeFile(path.join(folder, abandoned), 'partial');
    await fs.writeFile(path.join(folder, unrelated), 'keep');
    const downloads = new Downloads({}, () => {});
    await downloads.cleanupOrphans(folder);
    assert.deepEqual(await fs.readdir(folder), [unrelated]);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('a truncated response never becomes a completed original', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-truncated-test-'));
  const originalFetch = global.fetch;
  let failed;
  const completion = new Promise(resolve => { failed = resolve; });
  try {
    global.fetch = async () => new Response(Buffer.alloc(8), { status: 200 });
    const api = { detail: async id => ({
      id, file: { url: 'https://static1.e621.net/data/example.jpg', ext: 'jpg', size: 20 }, tags: {}, uploader: 'tester',
    }) };
    const downloads = new Downloads(api, job => { if (job.status === 'failed') failed(job); });
    downloads.start({ id: 123 }, folder, false);
    assert.match((await completion).result[0], /incomplete/);
    assert.deepEqual(await fs.readdir(folder), []);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('an incomplete existing original is reported instead of treated as a successful duplicate', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-incomplete-test-'));
  const originalFetch = global.fetch;
  const jobs = [];
  try {
    global.fetch = async () => { throw new Error('An incomplete file must not trigger a download'); };
    const api = { detail: async id => ({
      id, file: { url: 'https://static1.e621.net/data/example.jpg', ext: 'jpg', size: 20 }, tags: {}, uploader: 'tester',
    }) };
    const downloads = new Downloads(api, job => jobs.push(job));
    for (const [id, size] of [[789, 8], [790, 0]]) {
      const filename = `tester_fox_e621_${id}.jpg`;
      await fs.writeFile(path.join(folder, filename), Buffer.alloc(size));
      downloads.start({ id }, folder, false);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Incomplete duplicate was not rejected')), 1000);
        const check = () => {
          if (jobs.at(-1)?.postId === id && jobs.at(-1)?.status === 'failed') { clearTimeout(timeout); resolve(); }
          else setTimeout(check, 5);
        };
        check();
      });
      assert.match(jobs.at(-1).result[0], /incomplete/);
      assert.equal((await fs.stat(path.join(folder, filename))).size, size);
    }
    assert.deepEqual((await fs.readdir(folder)).sort(), ['tester_fox_e621_789.jpg', 'tester_fox_e621_790.jpg']);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('download history drops old finished jobs but keeps active jobs', () => {
  const downloads = new Downloads({}, () => {});
  downloads.jobs.set('active', { id: 'active', status: 'running' });
  for (let index = 0; index < 120; index++) {
    const job = { id: String(index), status: 'complete' };
    downloads.jobs.set(job.id, job);
    downloads.emit(job);
  }
  assert.equal(downloads.jobs.size, 101);
  assert.equal(downloads.jobs.has('active'), true);
  assert.equal(downloads.jobs.has('0'), false);
  assert.equal(downloads.jobs.has('119'), true);
});

test('restored download history marks unfinished jobs as interrupted', () => {
  const downloads = new Downloads({}, () => {});
  downloads.restore([
    { id: 'one', postId: 1, status: 'running', result: ['Сохранено'], receivedBytes: 8 },
    { id: 'two', postId: 2, status: 'complete', result: ['Файл уже сохранён'] },
  ]);
  assert.equal(downloads.list().length, 2);
  assert.equal(downloads.list()[0].status, 'failed');
  assert.deepEqual(downloads.list()[0].result, ['Saved', 'Interrupted when the app closed']);
  assert.equal(downloads.list()[1].status, 'complete');
  assert.equal(downloads.queue.length, 0);
});

test('a restored finished job does not prevent downloading the same post again', async () => {
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const downloads = new Downloads({}, job => { if (job.status === 'complete') finish(job); });
  downloads.restore([{ id: 'old', postId: 2, folder: '/downloads', status: 'complete', result: ['Сохранено'] }]);
  downloads.save = async () => {};
  const id = downloads.start({ id: 2 }, '/downloads', false);
  assert.notEqual(id, 'old');
  assert.equal((await completed).id, id);
});

test('Save + skips account actions after the account changes while saving', async () => {
  let releaseSave;
  let saveStarted;
  let finish;
  const started = new Promise(resolve => { saveStarted = resolve; });
  const saved = new Promise(resolve => { releaseSave = resolve; });
  const completed = new Promise(resolve => { finish = resolve; });
  const actions = [];
  let account = 'first';
  const downloads = new Downloads({
    upvote: async () => { actions.push('upvote'); },
    favorite: async () => { actions.push('favorite'); },
  }, job => { if (job.status === 'failed') finish(job); }, token => token === account);
  downloads.save = async () => { saveStarted(); await saved; };
  downloads.start({ id: 3 }, '/downloads', true, 'first');
  await started;
  account = 'second';
  releaseSave();
  const result = await completed;
  assert.deepEqual(actions, []);
  assert.deepEqual(result.result, ['Upvoted: account changed', 'Favorited: account changed']);
  assert.equal(downloads.list()[0].accountToken, undefined);
});

test('Save + checks the account again before adding to favorites', async () => {
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  let account = 'first';
  let favorites = 0;
  const downloads = new Downloads({
    upvote: async () => { account = 'second'; },
    favorite: async () => { favorites++; },
  }, job => { if (job.status === 'failed') finish(job); }, token => token === account);
  downloads.save = async () => {};
  downloads.start({ id: 4 }, '/downloads', true, 'first');
  const result = await completed;
  assert.equal(favorites, 0);
  assert.deepEqual(result.result, ['Upvoted', 'Favorited: account changed']);
});

test('a response without a known length still reports transferred bytes', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'e322-unknown-length-'));
  const originalFetch = global.fetch;
  let release;
  const pause = new Promise(resolve => { release = resolve; });
  const events = [];
  try {
    global.fetch = async () => ({
      ok: true, headers: new Headers(), body: (async function* () {
        yield Buffer.alloc(4096);
        await pause;
        yield Buffer.alloc(2048);
      })(),
    });
    const api = { detail: async id => ({
      id, file: { url: 'https://static1.e621.net/data/example.jpg', ext: 'jpg' }, tags: {}, uploader: 'tester',
    }) };
    const downloads = new Downloads(api, job => events.push(job));
    downloads.start({ id: 791 }, folder, false);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Byte progress was not reported')), 1000);
      const check = () => {
        if (events.some(job => job.status === 'running' && job.receivedBytes === 4096)) { clearTimeout(timeout); resolve(); }
        else setTimeout(check, 5);
      };
      check();
    });
    const progress = events.find(job => job.status === 'running' && job.receivedBytes === 4096);
    assert.equal(progress.totalBytes, 0);
    assert.equal(progress.fraction, 0);
    release();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Download did not finish')), 1000);
      const check = () => {
        if (events.at(-1)?.status === 'complete') { clearTimeout(timeout); resolve(); }
        else setTimeout(check, 5);
      };
      check();
    });
    assert.equal(events.at(-1).receivedBytes, 6144);
  } finally {
    release();
    global.fetch = originalFetch;
    await fs.rm(folder, { recursive: true, force: true });
  }
});

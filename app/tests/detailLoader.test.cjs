const test = require('node:test');
const assert = require('node:assert/strict');
const { DetailLoader } = require('../src/detailLoader.ts');

test('rapid navigation fetches only the final detail and reuses its cache', async () => {
  const fetched = [];
  const shown = [];
  const loader = new DetailLoader(async id => { fetched.push(id); return { id }; }, 10);
  try {
    loader.request(1, value => shown.push(value.id), () => {});
    loader.request(2, value => shown.push(value.id), () => {});
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(fetched, [2]);
    assert.deepEqual(shown, [2]);
    loader.request(2, value => shown.push(value.id), () => {});
    assert.deepEqual(fetched, [2]);
    assert.deepEqual(shown, [2, 2]);
    loader.invalidate(2);
    loader.request(2, value => shown.push(value.id), () => {}, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fetched, [2, 2]);
  } finally { loader.dispose(); }
});

test('invalidated in-flight detail cannot replace a newer result', async () => {
  const resolvers = [];
  const shown = [];
  const loader = new DetailLoader(() => new Promise(resolve => resolvers.push(resolve)), 0);
  try {
    loader.request(5, value => shown.push(value), () => {}, true);
    loader.invalidate(5);
    loader.request(5, value => shown.push(value), () => {}, true);
    assert.equal(resolvers.length, 2);
    resolvers[0]('old');
    resolvers[1]('new');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(shown, ['new']);
    loader.request(5, value => shown.push(value), () => {});
    assert.deepEqual(shown, ['new', 'new']);
  } finally { loader.dispose(); }
});

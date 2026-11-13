const test = require('node:test');
const assert = require('node:assert/strict');
const { PageLoadTracker } = require('../src/pageLoadTracker.ts');

test('an old page request cannot release a newer generation', () => {
  const loads = new PageLoadTracker();
  assert.equal(loads.claim(7, 1), true);
  assert.equal(loads.claim(7, 1), false);
  loads.clear();
  assert.equal(loads.claim(7, 2), true);
  loads.release(7, 1);
  assert.equal(loads.claim(7, 2), false);
  loads.release(7, 2);
  assert.equal(loads.claim(7, 2), true);
});

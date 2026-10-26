const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePoolIds } = require('../src/pools.ts');

test('compact e621 pool ids survive separators, duplicates, and invalid values', () => {
  assert.deepEqual(parsePoolIds('59027, 45368 59027; not-a-pool'), [59027, 45368]);
  assert.deepEqual(parsePoolIds('0 -4 12.5 9007199254740993'), []);
  assert.deepEqual(parsePoolIds([7, 7, 9]), [7, 9]);
});

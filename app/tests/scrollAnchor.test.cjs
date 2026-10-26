const test = require('node:test');
const assert = require('node:assert/strict');
const { nearestSurvivingId } = require('../src/scrollAnchor.ts');

test('a surviving post keeps its exact scroll anchor', () => {
  assert.equal(nearestSurvivingId([1, 2, 3].map(id => ({ id })), 2, new Set([1, 2, 3])), 2);
});

test('a hidden post returns to the next nearby post, regardless of how many earlier posts vanished', () => {
  const old = Array.from({ length: 160 }, (_, index) => ({ id: 1000 - index }));
  const available = new Set(old.filter(slot => slot.id !== 856 && slot.id % 7 !== 0).map(slot => slot.id));
  assert.equal(nearestSurvivingId(old, 856, available), 855);
});

test('anchor falls back backward or to the first result if no old post survives', () => {
  const old = [5, 4, 3, 2, 1].map(id => ({ id }));
  assert.equal(nearestSurvivingId(old, 2, new Set([5, 4])), 4);
  assert.equal(nearestSurvivingId(old, 2, new Set([9])), 9);
  assert.equal(nearestSurvivingId(old, 2, new Set()), null);
});

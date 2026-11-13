const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldApplyDownloadReaction } = require('../src/downloadReactions.ts');

test('combined results affect only the account revision that started them', () => {
  const job = { combined: true, accountRevision: 3, status: 'complete' };
  assert.equal(shouldApplyDownloadReaction(job, 3), true);
  assert.equal(shouldApplyDownloadReaction(job, 4), false);
  assert.equal(shouldApplyDownloadReaction({ ...job, accountRevision: null }, 3), false);
  assert.equal(shouldApplyDownloadReaction({ ...job, status: 'running' }, 3), false);
  assert.equal(shouldApplyDownloadReaction({ ...job, combined: false }, 3), false);
});

const assert = require('node:assert/strict');
const test = require('node:test');

const { isAutomaticRefresh, nodeDescription, viewStatus } = require('../source/refresh-status');

test('treats null and missing command arguments as manual refresh', () => {
  assert.equal(isAutomaticRefresh(null), false);
  assert.equal(isAutomaticRefresh(undefined), false);
  assert.equal(isAutomaticRefresh({ automatic: true }), true);
  assert.equal(isAutomaticRefresh({ automatic: false }), false);
});

test('marks the root once for stale data and identifies a timed-out controller', () => {
  assert.equal(nodeDescription({ id: '0' }, true), 'Last successful data');
  assert.equal(nodeDescription({ id: '0.0', parentId: '0' }, true), undefined);
  assert.equal(nodeDescription({ id: '0', error: 'controllerQueryTimedOut' }, false), 'Current query timed out');
  assert.equal(nodeDescription({ id: '0', error: 'controllerQueryTimedOut' }, true), 'Last successful data');
});

test('explains whole-tree timeout and partial controller failures in the view banner', () => {
  assert.equal(viewStatus({ stale: true, staleReason: 'USB topology query timed out; keeping the last successful data.' }),
    'USB topology query timed out; keeping the last successful data.');
  assert.equal(viewStatus({ partialFailures: 1 }), 'Other controllers updated; 1 controller query failed.');
});

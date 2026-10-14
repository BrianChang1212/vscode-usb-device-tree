const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutoRefreshPauseState } = require('../source/auto-refresh-pause');

test('pause and resume control auto refresh without writing user settings', () => {
  const state = createAutoRefreshPauseState();

  assert.equal(state.paused, false);
  state.pause();
  assert.equal(state.paused, true);
  state.resume();
  assert.equal(state.paused, false);
});

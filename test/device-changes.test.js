const assert = require('node:assert/strict');
const test = require('node:test');

const { portTransitions, TransientHighlights } = require('../source/device-changes');

function tree(status, identity = '') {
  return [{ id: '0', type: 'controller', children: [{ id: '0.0', type: 'hub', children: [
    { id: '0.0.0', type: 'port', status, pnpProperties: { instanceId: identity },
      children: [] },
  ] }] }];
}

test('marks connection green and removal red at the same physical port', () => {
  assert.deepEqual([...portTransitions(tree('disconnected'), tree('connected', 'USB\\A'))],
    [['0.0.0', 'connected']]);
  assert.deepEqual([...portTransitions(tree('connected', 'USB\\A'), tree('disconnected'))],
    [['0.0.0', 'disconnected']]);
  assert.deepEqual([...portTransitions(tree('connected', 'USB\\A'), tree('connected', 'USB\\A'))], []);
  assert.deepEqual([...portTransitions(tree('connected', 'USB\\A'), tree('connected', 'USB\\B'))],
    [['0.0.0', 'connected']]);
});

test('does not color the initial scan or an unknown query result', () => {
  assert.deepEqual([...portTransitions([], tree('connected', 'USB\\A'))], []);
  assert.deepEqual([...portTransitions(tree('connected'), tree('unknown'))], []);
  assert.deepEqual([...portTransitions([{ id: '0', type: 'controller',
    error: 'controllerQueryTimedOut', children: [] }], tree('connected', 'USB\\A'))], []);
});

test('clears a highlight after its display interval and restarts for another change', () => {
  const callbacks = [];
  const cleared = [];
  const events = [];
  const highlights = new TransientHighlights((ids) => events.push(ids), {
    durationMs: 1800,
    setTimeoutImpl(callback) { callbacks.push(callback); return callbacks.length - 1; },
    clearTimeoutImpl(id) { cleared.push(id); },
  });
  highlights.apply(tree('disconnected'), tree('connected', 'USB\\A'));
  assert.equal(highlights.get('0.0.0'), 'connected');
  highlights.apply(tree('connected', 'USB\\A'), tree('disconnected'));
  assert.equal(highlights.get('0.0.0'), 'disconnected');
  assert.deepEqual(cleared, [0]);
  callbacks[1]();
  assert.equal(highlights.get('0.0.0'), undefined);
  assert.deepEqual(events, [['0.0.0'], ['0.0.0'], ['0.0.0']]);
  highlights.dispose();
});

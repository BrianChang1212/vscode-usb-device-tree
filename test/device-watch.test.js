const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { DeviceChangeWatcher } = require('../source/device-watch');

test('starts one watcher, debounces device notices, and stops its process', () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.killCount = 0;
  child.kill = () => { child.killCount += 1; };
  const timers = [];
  let refreshes = 0;
  let spawnCount = 0;
  const watcher = new DeviceChangeWatcher('usb-topology.exe', () => { refreshes += 1; }, {
    spawnImpl(exe, args, options) {
      assert.equal(exe, 'usb-topology.exe');
      assert.deepEqual(args, ['--watch']);
      assert.equal(options.windowsHide, true);
      spawnCount += 1;
      return child;
    },
    setTimeoutImpl(callback, delay) { assert.equal(delay, 350); timers.push(callback); return timers.length - 1; },
    clearTimeoutImpl() {},
  });
  watcher.start();
  watcher.start();
  assert.equal(spawnCount, 1);
  child.stdout.emit('data', Buffer.from('ready\nchanged\nchanged\n'));
  assert.equal(refreshes, 0);
  timers[0]();
  assert.equal(refreshes, 0);
  timers.at(-1)();
  assert.equal(refreshes, 1);
  watcher.stop();
  assert.equal(child.killCount, 1);
  child.stdout.emit('data', Buffer.from('changed\n'));
  assert.equal(refreshes, 1);
});

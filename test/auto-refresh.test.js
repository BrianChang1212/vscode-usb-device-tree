const assert = require('node:assert/strict');
const test = require('node:test');

const { AutoRefreshScheduler } = require('../source/auto-refresh');

function createClock() {
  const timers = [];
  return {
    timers,
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      timer.cancelled = true;
    },
  };
}

test('refreshes on the configured interval and schedules the next run after completion', async () => {
  const clock = createClock();
  let refreshCount = 0;
  const scheduler = new AutoRefreshScheduler(
    async () => { refreshCount += 1; },
    { setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout },
  );

  scheduler.start(5000);
  assert.equal(refreshCount, 0);
  assert.equal(clock.timers[0].delay, 5000);

  clock.timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(refreshCount, 1);
  assert.equal(clock.timers[1].delay, 5000);
  scheduler.stop();
});

test('stopping cancels the pending refresh and ignores a late timer callback', () => {
  const clock = createClock();
  let refreshCount = 0;
  const scheduler = new AutoRefreshScheduler(
    () => { refreshCount += 1; },
    { setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout },
  );

  scheduler.start(1000);
  scheduler.stop();
  clock.timers[0].callback();

  assert.equal(clock.timers[0].cancelled, true);
  assert.equal(refreshCount, 0);
});

test('does not schedule overlapping refreshes while a run is still pending', async () => {
  const clock = createClock();
  let resolveRefresh;
  const scheduler = new AutoRefreshScheduler(
    () => new Promise((resolve) => { resolveRefresh = resolve; }),
    { setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout },
  );

  scheduler.start(1000);
  clock.timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clock.timers.length, 1);

  resolveRefresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clock.timers.length, 2);
  scheduler.stop();
});

test('schedules another attempt after a failed refresh', async () => {
  const clock = createClock();
  const scheduler = new AutoRefreshScheduler(
    async () => { throw new Error('refresh failed'); },
    { setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout },
  );

  scheduler.start(2000);
  clock.timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(clock.timers.length, 2);
  assert.equal(clock.timers[1].delay, 2000);
  scheduler.stop();
});

test('rejects a zero or invalid interval', () => {
  const scheduler = new AutoRefreshScheduler(() => {});

  assert.throws(() => scheduler.start(0), RangeError);
  assert.throws(() => scheduler.start(Number.NaN), RangeError);
});

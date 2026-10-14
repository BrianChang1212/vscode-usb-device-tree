class AutoRefreshScheduler {
  constructor(refresh, { setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
    this.refresh = refresh;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.intervalMs = undefined;
    this.timer = undefined;
    this.running = false;
  }

  start(intervalMs) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError('Auto-refresh interval must be a positive number.');
    }
    if (this.running && this.intervalMs === intervalMs) return;

    this.stop();
    this.intervalMs = intervalMs;
    this.running = true;
    this.scheduleNext();
  }

  stop() {
    this.running = false;
    if (this.timer !== undefined) {
      this.clearTimeoutImpl(this.timer);
      this.timer = undefined;
    }
  }

  scheduleNext() {
    this.timer = this.setTimeoutImpl(async () => {
      this.timer = undefined;
      if (!this.running) return;

      try {
        await this.refresh();
      } catch {
        // The refresh command owns user-facing and stale-data error handling.
      } finally {
        if (this.running) this.scheduleNext();
      }
    }, this.intervalMs);
  }
}

module.exports = { AutoRefreshScheduler };

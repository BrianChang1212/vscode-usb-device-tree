const { spawn } = require('node:child_process');

class DeviceChangeWatcher {
  constructor(executable, onChange, { spawnImpl = spawn, setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout } = {}) {
    this.executable = executable;
    this.onChange = onChange;
    this.spawnImpl = spawnImpl;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.child = undefined;
    this.timer = undefined;
    this.pending = '';
  }

  start() {
    if (this.child) return;
    const child = this.spawnImpl(this.executable, ['--watch'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    this.child = child;
    child.stdout.on('data', (chunk) => {
      if (this.child !== child) return;
      this.pending += chunk.toString('utf8');
      if (this.pending.length > 1024) this.pending = '';
      let newline;
      while ((newline = this.pending.indexOf('\n')) !== -1) {
        const line = this.pending.slice(0, newline).trim();
        this.pending = this.pending.slice(newline + 1);
        if (line === 'changed') this.scheduleChange();
      }
    });
    child.on('error', () => { if (this.child === child) this.stop(); });
    child.on('exit', () => { if (this.child === child) this.stop(); });
  }

  scheduleChange() {
    if (this.timer !== undefined) this.clearTimeoutImpl(this.timer);
    const timer = this.setTimeoutImpl(() => {
      if (this.timer !== timer) return;
      this.timer = undefined;
      if (this.child) this.onChange();
    }, 350);
    this.timer = timer;
  }

  stop() {
    if (this.timer !== undefined) this.clearTimeoutImpl(this.timer);
    this.timer = undefined;
    this.pending = '';
    const child = this.child;
    this.child = undefined;
    if (child) child.kill();
  }

  dispose() { this.stop(); }
}

module.exports = { DeviceChangeWatcher };

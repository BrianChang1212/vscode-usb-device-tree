function collectPorts(nodes, ports = new Map()) {
  for (const node of nodes) {
    if (node.type === 'port') {
      ports.set(node.id, {
        status: node.status,
        identity: node.pnpProperties?.instanceId || node.driverKeyName ||
          [node.vendorId, node.productId, node.serialNumber].filter((part) => part !== undefined).join(':'),
      });
    }
    collectPorts(node.children || [], ports);
  }
  return ports;
}

function collectUncertainPaths(nodes, paths = []) {
  for (const node of nodes) {
    if (node.error) paths.push(node.id);
    collectUncertainPaths(node.children || [], paths);
  }
  return paths;
}

function portTransitions(previous, current) {
  const transitions = new Map();
  if (!previous.length) return transitions;
  const oldPorts = collectPorts(previous);
  const uncertainPaths = collectUncertainPaths(previous);
  for (const [id, next] of collectPorts(current)) {
    if (uncertainPaths.some((path) => id === path || id.startsWith(`${path}.`))) continue;
    const before = oldPorts.get(id);
    if (next.status === 'connected' && (!before || before.status !== 'connected' ||
        (before.identity && next.identity && before.identity !== next.identity))) {
      transitions.set(id, 'connected');
    } else if (next.status === 'disconnected' && before?.status === 'connected') {
      transitions.set(id, 'disconnected');
    }
  }
  return transitions;
}

class TransientHighlights {
  constructor(onChange, { durationMs = 1800, setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout } = {}) {
    this.onChange = onChange;
    this.durationMs = durationMs;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.values = new Map();
    this.timers = new Map();
  }

  apply(previous, current) {
    for (const [id, kind] of portTransitions(previous, current)) {
      if (this.timers.has(id)) this.clearTimeoutImpl(this.timers.get(id));
      this.values.set(id, kind);
      const timer = this.setTimeoutImpl(() => {
        if (this.timers.get(id) !== timer) return;
        this.values.delete(id);
        this.timers.delete(id);
        this.onChange([id]);
      }, this.durationMs);
      this.timers.set(id, timer);
      this.onChange([id]);
    }
  }

  get(id) { return this.values.get(id); }

  dispose() {
    for (const timer of this.timers.values()) this.clearTimeoutImpl(timer);
    this.timers.clear();
    this.values.clear();
  }
}

module.exports = { portTransitions, TransientHighlights };

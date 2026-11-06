const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function topology(name = 'Radio', connected = true) {
  return { controllers: [{ type: 'controller', name: 'Host', instanceId: 'PCI\\HOST',
    ports: [{ type: 'port', port: 5, status: connected ? 'connected' : 'disconnected',
      children: connected ? [{ type: 'device', product: name, vendorId: 0x1234,
        productId: 1, serialPorts: [{ portName: name === 'Radio' ? 'COM4' : 'COM8' }] }] : [] }] }] };
}

function host(t) {
  const commands = new Map(), sent = [], reveals = [];
  let provider, receive, panel, next;
  class EventEmitter {
    constructor() { this.listeners = []; this.event = listener => {
      this.listeners.push(listener); return { dispose() {} };
    }; }
    fire(value) { for (const listener of this.listeners) listener(value); }
    dispose() {}
  }
  const vscode = { EventEmitter, ViewColumn: { Beside: 2 }, ProgressLocation: { Window: 10 },
    Uri: { joinPath: (...parts) => parts.join('/') },
    window: {
      registerWebviewViewProvider(_id, value) { provider = value; return { dispose() {} }; },
      createWebviewPanel() { panel = { webview: {}, onDidDispose() {}, reveal(...args) { reveals.push(args); } }; return panel; },
      withProgress(_options, run) { return run(); }, showErrorMessage() {},
    },
    commands: {
      registerCommand(id, run) { commands.set(id, run); return { dispose() {} }; },
      executeCommand(id, ...args) { return Promise.resolve(commands.get(id)?.(...args)); },
    },
    workspace: { getConfiguration() { return { get: (_key, fallback) => fallback }; },
      onDidChangeConfiguration() { return { dispose() {} }; } },
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    if (request === './native' && parent.filename.endsWith('extension.js')) return {
      queryUsbTopology: async () => { if (next instanceof Error) throw next; return next; },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../source/extension')];
  let extension;
  try { extension = require('../source/extension'); } finally { Module._load = originalLoad; }
  const context = { extensionPath: 'fixture', extensionUri: 'fixture', subscriptions: [] };
  extension.activate(context);
  provider.resolveWebviewView({ visible: false, onDidChangeVisibility() {}, webview: {
    cspSource: 'fixture:', asWebviewUri: value => value,
    onDidReceiveMessage: listener => { receive = listener; },
    postMessage: value => { sent.push(value); return Promise.resolve(true); },
  } });
  t.after(() => { for (const item of context.subscriptions) item.dispose?.(); });
  return {
    async refresh(value, automatic = false) { next = value; await commands.get('usbDeviceTree.refresh')({ automatic }); },
    select(id) { receive({ type: 'select', id }); }, search(query) { receive({ type: 'search', query }); },
    get html() { return panel.webview.html; }, get state() { return sent.at(-1); }, reveals,
  };
}

test('selected details update on manual and automatic refresh without revealing again', async t => {
  const app = host(t);
  await app.refresh(topology()); app.select('0.0');
  assert.match(app.html, /Radio/); assert.match(app.html, /COM4/);
  await app.refresh(topology('Camera'));
  assert.match(app.html, /Camera/); assert.match(app.html, /COM8/); assert.doesNotMatch(app.html, /Radio|COM4/);
  await app.refresh(topology('Scanner'), true);
  assert.match(app.html, /Scanner/); assert.equal(app.reveals.length, 1);
});

test('disconnect and reconnect replace device identity and missing ports do not retain live data', async t => {
  const app = host(t);
  await app.refresh(topology()); app.select('0.0');
  await app.refresh(topology('Radio', false), true);
  assert.match(app.html, />DISCONNECTED</); assert.doesNotMatch(app.html, /Radio|COM4/);
  await app.refresh(topology('Camera'), true);
  assert.match(app.html, /Camera/); assert.doesNotMatch(app.html, /Radio|COM4/);
  await app.refresh({ controllers: [] }, true);
  assert.match(app.html, />DISCONNECTED</); assert.doesNotMatch(app.html, /Camera|COM8/);
  await app.refresh(topology(), true);
  assert.match(app.html, /Radio/); assert.match(app.html, />CONNECTED</);
});

test('query errors mark retained detail data stale and a successful refresh clears the warning', async t => {
  const app = host(t);
  await app.refresh(topology()); app.select('0.0');
  await app.refresh(new Error('query failed'), true);
  assert.match(app.html, />STALE</); assert.match(app.html, /last successful data/);
  assert.match(app.html, /Radio/); assert.doesNotMatch(app.html, />CONNECTED</);
  await app.refresh(topology('Camera'), true);
  assert.match(app.html, />CONNECTED</); assert.doesNotMatch(app.html, />STALE</);
});

test('selection follows its physical location through reordering and filtered refreshes', async t => {
  const app = host(t);
  await app.refresh(topology()); app.select('0.0');
  const reordered = topology('Camera');
  reordered.controllers.unshift({ type: 'controller', name: 'Other host', instanceId: 'PCI\\OTHER', ports: [] });
  await app.refresh(reordered, true);
  assert.match(app.html, /Camera/); assert.equal(app.state.selectedId, '1.0');
  app.search('no matching device');
  await app.refresh(topology('Scanner'), true);
  assert.match(app.html, /Scanner/); assert.equal(app.state.nodes.length, 0);
  app.search(''); assert.equal(app.state.selectedId, '0.0');
  app.select('0'); assert.match(app.html, /Host/); assert.doesNotMatch(app.html, /Scanner/);
});

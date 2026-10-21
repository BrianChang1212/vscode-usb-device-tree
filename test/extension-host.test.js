const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('activates the contributed webview and routes its toolbar commands', async () => {
  const commands = new Map();
  const sent = [];
  let viewProvider;
  let receiveMessage;
  let detailPanel;
  class EventEmitter {
    constructor() { this.listeners = []; this.event = (listener) => {
      this.listeners.push(listener); return { dispose() {} };
    }; }
    fire(value) { for (const listener of this.listeners) listener(value); }
    dispose() {}
  }
  const vscode = {
    EventEmitter,
    ViewColumn: { Beside: 2 },
    Uri: { joinPath: (...parts) => parts.join('/') },
    window: {
      registerWebviewViewProvider(id, provider) {
        assert.equal(id, 'usbDeviceTree.devices');
        viewProvider = provider;
        return { dispose() {} };
      },
      createWebviewPanel() {
        detailPanel = { webview: {}, onDidDispose() {}, reveal() {} };
        return detailPanel;
      },
    },
    commands: {
      registerCommand(id, callback) { commands.set(id, callback); return { dispose() {} }; },
      executeCommand(id, ...args) { return Promise.resolve(commands.get(id)?.(...args)); },
    },
    workspace: {
      getConfiguration() { return { get(_key, fallback) { return fallback; } }; },
      onDidChangeConfiguration() { return { dispose() {} }; },
    },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  let extension;
  try { extension = require('../source/extension'); }
  finally { Module._load = originalLoad; }
  const context = { extensionPath: 'extension', extensionUri: 'extension', subscriptions: [] };
  extension.activate(context);
  const view = {
    visible: false,
    onDidChangeVisibility() { return { dispose() {} }; },
    webview: {
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri) => uri,
      onDidReceiveMessage: (listener) => { receiveMessage = listener; },
      postMessage: (message) => { sent.push(message); return Promise.resolve(true); },
    },
  };
  viewProvider.resolveWebviewView(view);
  assert.match(view.webview.html, /USB TOPOLOGY/);
  assert.equal(view.webview.options.enableScripts, true);
  await commands.get('usbDeviceTree.expandAll')();
  assert.ok(sent.some((message) => message.type === 'expandAll'));
  receiveMessage({ type: 'action', action: 'expand' });
  assert.ok(sent.filter((message) => message.type === 'expandAll').length >= 2);
  receiveMessage({ type: 'search', query: 'COM4' });
  assert.equal(viewProvider.provider.searchQuery, 'COM4');
  receiveMessage({ type: 'action', action: 'pause' });
  assert.equal(sent.at(-1).paused, true);
  receiveMessage({ type: 'action', action: 'pause' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.at(-1).paused, false);
  receiveMessage({ type: 'search', query: '' });
  viewProvider.provider.setTopology({ controllers: [{ type: 'controller', name: 'Host', ports: [] }] });
  receiveMessage({ type: 'select', id: '0' });
  assert.match(detailPanel.webview.html, /class="device-hero"/);
  assert.match(detailPanel.webview.html, /Host/);
  for (const disposable of context.subscriptions) disposable.dispose?.();
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { presentTree, renderTreeHtml, UsbTreeWebview } = require('../source/webview-tree');

test('sends only display fields and transient state to the tree webview', () => {
  const nodes = [{ id: '0', type: 'controller', label: 'Host', detailText: 'secret',
    children: [{ id: '0.0', type: 'port', label: 'Port 1: device', port: 1,
      status: 'connected', vendorId: 0x0489, productId: 0xe122, children: [] }] }];
  const result = presentTree(nodes, { get: (id) => id === '0.0' ? 'connected' : undefined });
  assert.equal(result[0].children[0].label, 'Port 1: device');
  assert.equal(result[0].children[0].change, 'connected');
  assert.equal(result[0].children[0].meta, 'VID 0489 · PID e122');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('retains stale and per-controller failure labels in the custom tree', () => {
  const node = { id: '0', type: 'controller', label: 'Host', error: 'controllerQueryTimedOut', children: [] };
  assert.equal(presentTree([node], undefined)[0].meta, 'Current query timed out');
  assert.equal(presentTree([node], undefined, true)[0].meta, 'Last successful data');
});

test('tree view uses local assets and a restrictive content security policy', () => {
  const html = renderTreeHtml('vscode-resource:/tree.css', 'vscode-resource:/tree.js', 'vscode-resource:');
  assert.match(html, /class="tree-shell"/);
  assert.match(html, /script-src vscode-resource:/);
  assert.match(html, /style-src vscode-resource:/);
  assert.match(html, /class="tree-search"/);
});

test('tree webview routes search, selection, and actions through the existing provider', () => {
  const messages = [];
  const actions = [];
  const searches = [];
  const selected = [];
  class EventEmitter {
    constructor() { this.listeners = []; this.event = (fn) => { this.listeners.push(fn); return { dispose() {} }; }; }
    fire(value) { for (const fn of this.listeners) fn(value); }
    dispose() {}
  }
  const vscode = { EventEmitter, Uri: { joinPath: (...parts) => parts.join('/') } };
  const node = { id: '0', label: 'Host', type: 'controller', children: [] };
  const provider = { nodes: [node], allNodes: [node], nodesById: new Map([['0', node]]),
    searchQuery: '', setSearchQuery: (query) => searches.push(query) };
  const tree = new UsbTreeWebview(vscode, 'extension', provider, undefined,
    (action) => actions.push(action));
  tree.onDidChangeSelection(({ selection }) => selected.push(selection[0].id));
  tree.view = { webview: { postMessage: (value) => messages.push(value) }, visible: true };
  tree.handleMessage({ type: 'search', query: 'COM4' });
  tree.handleMessage({ type: 'select', id: '0' });
  tree.handleMessage({ type: 'select', id: 'missing' });
  tree.handleMessage({ type: 'action', action: 'refresh' });
  tree.handleMessage({ type: 'action', action: 'delete' });
  tree.expandAll();
  tree.update();
  assert.deepEqual(searches, ['COM4']);
  assert.deepEqual(selected, ['0']);
  assert.deepEqual(actions, ['refresh']);
  assert.equal(messages[0].type, 'expandAll');
  assert.equal(messages[1].nodes[0].label, 'Host');
});

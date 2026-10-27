const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const { format, englishT } = require('../source/l10n');
const { guideCss } = require('../source/style');
const { presentTree, renderTreeHtml, sidebarStrings } = require('../source/webview-tree');
const { renderDetailHtml } = require('../source/detail');
const { toTreeNodes } = require('../source/tree');
const { viewStatus } = require('../source/refresh-status');
const { assertGuideCss, assertStateColors } = require('./style-assertions');

const root = path.resolve(__dirname, '..');
const bundle = JSON.parse(fs.readFileSync(path.join(root, 'l10n', 'bundle.l10n.zh-tw.json'), 'utf8'));
const zhT = (message, ...args) => format(bundle[message] ?? message, args);
const CJK = /[\u3400-\u9fff]/;

const sampleNode = { label: 'Port 5: Radio', port: 5, status: 'connected',
  vendorId: 0x0489, productId: 0xe122, speed: 'full', deviceClass: 0xe0,
  detailSections: [
    { title: 'Physical Port', text: 'Status: connected\nPort: 5' },
    { title: 'USB Device', text: 'Speed: full\nVendor ID: 0x0489\nManufacturer: Foxconn\nPnP driverInf: oem42.inf\nDevice descriptor bytes: 1201' },
  ] };

test('sidebar HTML renders English with lang=en and no Chinese', () => {
  const html = renderTreeHtml('vscode-resource:/tree.css', 'vscode-resource:/tree.js', 'vscode-resource:', englishT, 'en');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /USB TOPOLOGY/);
  assert.match(html, />Expand all</);
  assert.match(html, /placeholder="Search · device, VID\/PID, COM"/);
  assert.match(html, /aria-label="USB device topology"/);
  assert.doesNotMatch(html, CJK);
});

test('sidebar HTML renders Traditional Chinese with lang=zh-Hant and keeps CSP and asset URIs', () => {
  const html = renderTreeHtml('vscode-resource:/tree.css', 'vscode-resource:/tree.js', 'vscode-resource:', zhT, 'zh-tw');
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, />全部展開</);
  assert.match(html, />重新整理</);
  assert.match(html, /placeholder="搜尋 · 裝置、VID\/PID、COM"/);
  assert.match(html, /aria-label="USB 裝置拓撲"/);
  assert.match(html, /script-src vscode-resource:/);
  assert.match(html, /href="vscode-resource:\/tree.css"/);
  assert.doesNotMatch(html, /Expand all|Collapse|>Refresh<|>Pause<|Search devices|HARDWARE/);
});

test('sidebar string table is fully translated for the browser-side tree', () => {
  const english = sidebarStrings(englishT);
  const chinese = sidebarStrings(zhT);
  assert.deepEqual(Object.keys(chinese), Object.keys(english));
  for (const key of Object.keys(english)) {
    assert.doesNotMatch(english[key], CJK, `English ${key}`);
    assert.notEqual(chinese[key], english[key], `untranslated ${key}`);
  }
  assert.equal(format(chinese.expandNode, ['Hub']), '展開 Hub');
});

test('tree labels and metadata translate while USB-sourced names and VID/PID stay as-is', () => {
  const topology = [{ type: 'controller', name: 'Intel xHCI', ports: [
    { type: 'port', port: 1, status: 'connected', children: [{ type: 'device', vendorId: 0x0489, productId: 0xe122,
      pnpProperties: { friendlyName: 'Foxconn Radio' } }] },
    { type: 'port', port: 2, status: 'disconnected' },
  ] }];
  const zhNodes = toTreeNodes(topology, '', zhT);
  assert.equal(zhNodes[0].label, 'Intel xHCI');
  assert.equal(zhNodes[0].children[0].label, '連接埠 1：Foxconn Radio');
  assert.equal(zhNodes[0].children[1].label, '連接埠 2：未連線');
  assert.equal(presentTree(zhNodes, undefined, false, zhT)[0].meta, '2 個分支');
  assert.equal(presentTree(zhNodes, undefined, false, zhT)[0].children[0].meta, 'VID 0489 · PID e122');
  assert.equal(presentTree(zhNodes, undefined, true, zhT)[0].meta, '上次成功的資料');
  const enNodes = toTreeNodes(topology);
  assert.equal(enNodes[0].children[0].label, 'Port 1: Foxconn Radio');
  assert.equal(enNodes[0].children[1].label, 'Port 2: disconnected');
  const bare = toTreeNodes([{ type: 'controller', name: 'x', ports: [{ type: 'port', port: 3, status: 'connected' }] }], '', zhT);
  assert.equal(bare[0].children[0].label, '連接埠 3：已連線');
  assert.equal(presentTree(enNodes, undefined)[0].meta, '2 branches');
  assert.equal(viewStatus({ partialFailures: 2, t: zhT }), '其他控制器已更新；2 個控制器查詢失敗。');
  assert.equal(viewStatus({ autoRefreshRunning: true, intervalSeconds: 5, t: zhT }), '每 5 秒自動重新整理；可從工具列暫停。');
});

test('sidebar CSS is the guide CSS plus tree components with readable connection state colors', () => {
  const css = fs.readFileSync(path.join(root, 'resources', 'tree.css'), 'utf8');
  assert.ok(css.startsWith(guideCss('sideBar').trimStart()), 'tree.css must start with guideCss("sideBar")');
  assertGuideCss(css, 'sideBar');
  assertStateColors(css, [['.connected .node-glyph', '--accent'], ['.change-disconnected .node-glyph', '--danger'],
    ['.live-state.running', '--accent']]);
});

test('detail panel renders English with lang=en and guide CSS', () => {
  const html = renderDetailHtml(sampleNode, englishT, 'en');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Physical Port/);
  assert.match(html, /Connection Status/);
  assert.match(html, /USB SPEED/);
  assert.doesNotMatch(html, CJK);
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assertGuideCss(css, 'editor');
  assertStateColors(css, [['.state.connected', '--accent'], ['.state.disconnected', '--danger']]);
  assert.match(html, /style-src 'unsafe-inline'/);
});

test('detail panel renders Traditional Chinese and leaves USB-sourced values untranslated', () => {
  const html = renderDetailHtml(sampleNode, zhT, 'zh-tw');
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, /實體連接埠/);
  assert.match(html, /連線狀態/);
  assert.match(html, /USB 速度/);
  assert.match(html, /製造商/);
  assert.match(html, /Foxconn/);
  assert.match(html, /VID 0489/);
  assert.match(html, /Full Speed/);
  assert.match(html, /oem42\.inf/);
  assert.match(html, /已連線/);
  assert.doesNotMatch(html, /Physical Port|Raw Data|Connection Status|Manufacturer|DEVICE CLASS|Descriptors and Configurations/);
});

test('extension layer sends notifications, InputBox and view HTML through vscode.l10n.t', async () => {
  const commands = new Map();
  const shown = [];
  let viewProvider;
  let detailPanel;
  class EventEmitter {
    constructor() { this.listeners = []; this.event = (listener) => { this.listeners.push(listener); return { dispose() {} }; }; }
    fire(value) { for (const listener of this.listeners) listener(value); }
    dispose() {}
  }
  const vscode = {
    EventEmitter,
    env: { language: 'zh-tw' },
    l10n: { t: zhT },
    ViewColumn: { Beside: 2 },
    ProgressLocation: { Window: 10 },
    Uri: { joinPath: (...parts) => parts.join('/') },
    window: {
      registerWebviewViewProvider(_id, provider) { viewProvider = provider; return { dispose() {} }; },
      createWebviewPanel(_type, title) { detailPanel = { title, webview: {}, onDidDispose() {}, reveal() {} }; return detailPanel; },
      showWarningMessage: async (message) => { shown.push(['warning', message]); },
      showErrorMessage: async (message) => { shown.push(['error', message]); },
      showInformationMessage: async (message) => { shown.push(['info', message]); },
      showInputBox: async (options) => { shown.push(['input', options.prompt]); return undefined; },
      withProgress: async (options, task) => { shown.push(['progress', options.title]); return task(); },
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
  const extensionPath = require.resolve('../source/extension');
  delete require.cache[extensionPath];
  let extension;
  try { extension = require('../source/extension'); }
  finally { Module._load = originalLoad; delete require.cache[extensionPath]; }
  const context = { extensionPath: path.join(root, '.missing-extension-root'), extensionUri: 'extension', subscriptions: [] };
  extension.activate(context);
  const sent = [];
  const view = {
    visible: false,
    onDidChangeVisibility() { return { dispose() {} }; },
    webview: { cspSource: 'vscode-resource:', asWebviewUri: (uri) => uri, onDidReceiveMessage() {},
      postMessage: (message) => { sent.push(message); return Promise.resolve(true); } },
  };
  viewProvider.resolveWebviewView(view);
  assert.match(view.webview.html, /<html lang="zh-Hant">/);
  assert.match(view.webview.html, /全部展開/);
  assert.equal(sent.at(-1).strings.resume, '繼續');

  await commands.get('usbDeviceTree.exportSnapshot')();
  await commands.get('usbDeviceTree.search')();
  await commands.get('usbDeviceTree.refresh')();
  assert.deepEqual(shown.filter(([kind]) => kind === 'warning'), [['warning', '請先查詢 USB 裝置樹再匯出 XML。']]);
  assert.deepEqual(shown.filter(([kind]) => kind === 'input'), [['input', '搜尋 USB 節點名稱、連接埠、狀態或裝置詳細資料']]);
  assert.deepEqual(shown.filter(([kind]) => kind === 'progress'), [['progress', '正在查詢 USB 裝置樹']]);
  const error = shown.find(([kind]) => kind === 'error');
  assert.ok(error && CJK.test(error[1]), `expected a translated error, got ${error}`);

  viewProvider.provider.setTopology({ controllers: [{ type: 'controller', name: 'Host', ports: [] }] });
  viewProvider.handleMessage({ type: 'select', id: '0' });
  assert.match(detailPanel.webview.html, /<html lang="zh-Hant">/);
  assert.match(detailPanel.webview.html, /主機控制器/);
  for (const disposable of context.subscriptions) disposable.dispose?.();
});

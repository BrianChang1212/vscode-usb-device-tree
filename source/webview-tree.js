const { escapeHtml } = require('./detail');
const { nodeDescription } = require('./refresh-status');

function presentTree(nodes, highlights, stale = false) {
  return nodes.map((node) => {
    const ids = Number.isInteger(node.vendorId) && Number.isInteger(node.productId)
      ? `VID ${node.vendorId.toString(16).padStart(4, '0')} · PID ${node.productId.toString(16).padStart(4, '0')}` : '';
    const ordinaryMeta = node.type === 'controller' && node.children.length
      ? `${node.children.length} branch${node.children.length === 1 ? '' : 'es'}` : ids;
    const meta = nodeDescription(node, stale) || ordinaryMeta;
    return {
      id: node.id, type: node.type, label: node.label, status: node.status || '',
      meta, change: highlights?.get(node.id) || '',
      children: presentTree(node.children, highlights, stale),
    };
  });
}

function renderTreeHtml(styleUri, scriptUri, cspSource) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(cspSource)}; script-src ${escapeHtml(cspSource)};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${escapeHtml(styleUri)}"><title>USB Topology</title></head>
<body><div class="tree-shell">
  <header class="tree-header"><div class="overline">HARDWARE / USB</div><div class="title-line"><h1>USB TOPOLOGY</h1><span id="live-state" class="live-state">IDLE</span></div></header>
  <div class="tree-tools"><label class="search-label" for="tree-search">Search devices and ports</label><input id="tree-search" class="tree-search" type="search" autocomplete="off" placeholder="Search · device, VID/PID, COM"></div>
  <div class="tree-actions"><button type="button" data-action="expand">Expand all</button><button type="button" data-action="collapse">Collapse</button><button type="button" data-action="refresh">Refresh</button><button type="button" data-action="pause" id="pause-action">Pause</button><button type="button" data-action="export">XML</button></div>
  <div id="tree-status" class="tree-status" role="status"></div>
  <div id="tree-list" class="tree-list" role="tree" aria-label="USB device topology"></div>
</div><script src="${escapeHtml(scriptUri)}"></script></body></html>`;
}

class UsbTreeWebview {
  constructor(vscode, extensionUri, provider, highlights, onAction) {
    this.vscode = vscode;
    this.extensionUri = extensionUri;
    this.provider = provider;
    this.highlights = highlights;
    this.onAction = onAction;
    this.visibilityEmitter = new vscode.EventEmitter();
    this.onDidChangeVisibility = this.visibilityEmitter.event;
    this.selectionEmitter = new vscode.EventEmitter();
    this.onDidChangeSelection = this.selectionEmitter.event;
    this.message = undefined;
    this.view = undefined;
  }

  get visible() { return Boolean(this.view?.visible); }

  resolveWebviewView(view) {
    this.view = view;
    const resources = this.vscode.Uri.joinPath(this.extensionUri, 'resources');
    view.webview.options = { enableScripts: true, localResourceRoots: [resources] };
    const styleUri = view.webview.asWebviewUri(this.vscode.Uri.joinPath(resources, 'tree.css'));
    const scriptUri = view.webview.asWebviewUri(this.vscode.Uri.joinPath(resources, 'tree.js'));
    view.webview.html = renderTreeHtml(styleUri, scriptUri, view.webview.cspSource);
    view.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    view.onDidChangeVisibility(() => this.visibilityEmitter.fire({ visible: view.visible }));
    this.update();
    this.visibilityEmitter.fire({ visible: view.visible });
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready') { this.update(); return; }
    if (message.type === 'search' && typeof message.query === 'string') {
      this.provider.setSearchQuery(message.query.slice(0, 256));
      return;
    }
    if (message.type === 'select' && typeof message.id === 'string') {
      const node = this.provider.nodesById.get(message.id);
      if (node) this.selectionEmitter.fire({ selection: [node] });
      return;
    }
    if (message.type === 'action' && ['expand', 'collapse', 'refresh', 'pause', 'export'].includes(message.action)) {
      this.onAction(message.action);
    }
  }

  expandAll() { void this.view?.webview.postMessage({ type: 'expandAll' }); }

  update() {
    void this.view?.webview.postMessage({
      type: 'state', nodes: presentTree(this.provider.nodes, this.highlights, this.provider.stale),
      query: this.provider.searchQuery, message: this.message || '',
      paused: this.paused || false, running: this.running || false,
      hasData: this.provider.allNodes.length > 0,
    });
  }

  dispose() { this.visibilityEmitter.dispose(); this.selectionEmitter.dispose(); }
}

module.exports = { presentTree, renderTreeHtml, UsbTreeWebview };

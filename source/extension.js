const vscode = require('vscode');
const path = require('node:path');

const { AutoRefreshScheduler } = require('./auto-refresh');
const { createAutoRefreshPauseState } = require('./auto-refresh-pause');
const { DetailsPanel } = require('./detail');
const { TransientHighlights } = require('./device-changes');
const { DeviceChangeWatcher } = require('./device-watch');
const { queryUsbTopology } = require('./native');
const { isAutomaticRefresh, nodeDescription, viewStatus } = require('./refresh-status');
const { createSnapshot, exportSnapshot } = require('./snapshot');
const { filterTreeNodes, toTreeNodes } = require('./tree');

class UsbDeviceTreeProvider {
  constructor(highlights) {
    this.highlights = highlights;
    this.nodes = [];
    this.allNodes = [];
    this.nodesById = new Map();
    this.stale = false;
    this.staleReason = undefined;
    this.partialFailures = 0;
    this.searchQuery = '';
    this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  }

  getTreeItem(node) {
    const collapsibleState = node.children.length
      ? (this.searchQuery.trim()
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed)
      : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.label, collapsibleState);
    item.id = node.id;
    item.resourceUri = vscode.Uri.from({ scheme: 'usb-device-tree', path: `/${node.id}` });
    const change = this.highlights?.get(node.id);
    if (change) {
      const color = new vscode.ThemeColor(change === 'connected'
        ? 'gitDecoration.addedResourceForeground' : 'gitDecoration.deletedResourceForeground');
      item.iconPath = new vscode.ThemeIcon('circle-filled', color);
    }
    item.contextValue = 'usbDeviceTree.node';
    item.description = nodeDescription(node, this.stale);
    item.tooltip = node.detailText;
    item.children = node.children;
    return item;
  }

  getChildren(node) {
    return node ? node.children : this.nodes;
  }

  getParent(node) {
    return node.parentId ? this.nodesById.get(node.parentId) : undefined;
  }

  setTopology(topology) {
    const nextNodes = toTreeNodes(topology.controllers);
    this.highlights?.apply(this.allNodes, nextNodes);
    this.allNodes = nextNodes;
    this.nodes = filterTreeNodes(this.allNodes, this.searchQuery);
    this.rebuildNodeMap();
    this.stale = false;
    this.staleReason = undefined;
    this.partialFailures = topology.partialFailures || 0;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  setSearchQuery(query) {
    this.searchQuery = query;
    this.nodes = filterTreeNodes(this.allNodes, query);
    this.rebuildNodeMap();
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  rebuildNodeMap() {
    this.nodesById.clear();
    const visit = (nodes) => {
      for (const node of nodes) {
        this.nodesById.set(node.id, node);
        visit(node.children);
      }
    };
    visit(this.nodes);
  }

  markStale(reason) {
    this.stale = true;
    this.staleReason = reason;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }
}

function friendlyError(error) {
  switch (error.code) {
    case 'UNSUPPORTED_PLATFORM': return 'USB Device Tree currently supports Windows x64.';
    case 'NATIVE_NOT_FOUND': return 'The bundled USB topology helper was not found. Reinstall the extension.';
    case 'PROCESS_TIMEOUT': return 'USB topology query timed out; keeping the last successful data.';
    case 'OUTPUT_TOO_LARGE':
    case 'TOO_MANY_NODES': return 'USB topology exceeded the size limit; keeping the last successful data.';
    case 'MALFORMED_JSON':
    case 'INVALID_TOPOLOGY': return 'The USB topology helper returned invalid data; keeping the last successful data.';
    default: return 'Could not update the USB device tree; keeping the last successful data.';
  }
}

function activate(context) {
  const decorationChanges = new vscode.EventEmitter();
  const highlights = new TransientHighlights((ids) => {
    decorationChanges.fire(ids.map((id) => vscode.Uri.from({ scheme: 'usb-device-tree', path: `/${id}` })));
    provider.onDidChangeTreeDataEmitter.fire(undefined);
  });
  const provider = new UsbDeviceTreeProvider(highlights);
  const decorationProvider = {
    onDidChangeFileDecorations: decorationChanges.event,
    provideFileDecoration(uri) {
      if (uri.scheme !== 'usb-device-tree') return undefined;
      const change = highlights.get(uri.path.slice(1));
      if (!change) return undefined;
      const color = new vscode.ThemeColor(change === 'connected'
        ? 'gitDecoration.addedResourceForeground' : 'gitDecoration.deletedResourceForeground');
      const decoration = new vscode.FileDecoration(undefined,
        change === 'connected' ? 'Just connected' : 'Just disconnected', color);
      decoration.propagate = false;
      return decoration;
    },
  };
  const detailsPanel = new DetailsPanel(vscode, context.subscriptions);
  const treeView = vscode.window.createTreeView('usbDeviceTree.devices', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  const autoRefresh = new AutoRefreshScheduler(
    () => vscode.commands.executeCommand('usbDeviceTree.refresh', { automatic: true }),
  );
  const watcher = new DeviceChangeWatcher(path.join(context.extensionPath,
    'native', 'bin', 'win32-x64', 'usb-topology.exe'),
  () => vscode.commands.executeCommand('usbDeviceTree.refresh', { automatic: true }));
  const pauseState = createAutoRefreshPauseState();
  let lastSuccessfulSnapshot;
  let refreshing = false;

  context.subscriptions.push({ dispose: () => autoRefresh.stop() }, watcher,
    { dispose: () => highlights.dispose() }, decorationChanges,
    vscode.window.registerFileDecorationProvider(decorationProvider),
    treeView, provider.onDidChangeTreeDataEmitter);

  treeView.onDidChangeVisibility(({ visible }) => {
    if (visible && isAutoRefreshEnabled()) {
      void vscode.commands.executeCommand('usbDeviceTree.refresh', { automatic: true });
    }
    syncAutoRefresh();
  }, undefined, context.subscriptions);
  treeView.onDidChangeSelection(({ selection }) => {
    if (selection[0]) detailsPanel.show(selection[0]);
  }, undefined, context.subscriptions);

  context.subscriptions.push(
    vscode.commands.registerCommand('usbDeviceTree.refresh', async (options = {}) => {
      if (refreshing) return;
      const automatic = isAutomaticRefresh(options);
      refreshing = true;
      const readTopology = async () => {
        try {
          const topology = await queryUsbTopology(context.extensionPath);
          const snapshot = createSnapshot(topology);
          provider.setTopology(topology);
          lastSuccessfulSnapshot = snapshot;
          updateMessage();
        } catch (error) {
          provider.markStale(friendlyError(error));
          updateMessage();
          if (!automatic) await vscode.window.showErrorMessage(friendlyError(error));
        }
      };
      try {
        if (automatic) await readTopology();
        else await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: 'Querying USB device tree' }, readTopology,
        );
      } finally {
        refreshing = false;
        syncAutoRefresh();
      }
    }),
    vscode.commands.registerCommand('usbDeviceTree.pauseAutoRefresh', () => {
      pauseState.pause();
      syncAutoRefresh();
    }),
    vscode.commands.registerCommand('usbDeviceTree.resumeAutoRefresh', async () => {
      pauseState.resume();
      if (treeView.visible) await vscode.commands.executeCommand('usbDeviceTree.refresh', { automatic: true });
      syncAutoRefresh();
    }),
    vscode.commands.registerCommand('usbDeviceTree.search', async () => {
      const query = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        prompt: 'Search USB node names, ports, status, or device details',
        value: provider.searchQuery,
      });
      if (query === undefined) return;
      provider.setSearchQuery(query);
      updateMessage();
      if (query.trim()) {
        const target = firstLeaf(provider.nodes[0]);
        if (target) await treeView.reveal(target, { expand: true, focus: false, select: false });
      }
    }),
    vscode.commands.registerCommand('usbDeviceTree.exportSnapshot', async () => {
      if (!lastSuccessfulSnapshot) {
        await vscode.window.showWarningMessage('Query the USB device tree before exporting XML.');
        return;
      }
      try {
        const saved = await exportSnapshot(vscode, lastSuccessfulSnapshot);
        if (saved) await vscode.window.showInformationMessage('USB Device Tree XML snapshot exported.');
      } catch {
        await vscode.window.showErrorMessage('Could not export the USB XML snapshot.');
      }
    }),
  );

  const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('usbDeviceTree.autoRefreshEnabled')
      || event.affectsConfiguration('usbDeviceTree.refreshIntervalSeconds')) syncAutoRefresh();
  });
  context.subscriptions.push(configSubscription);

  function isAutoRefreshEnabled() {
    return vscode.workspace.getConfiguration('usbDeviceTree').get('autoRefreshEnabled', true)
      && !pauseState.paused;
  }

  function syncAutoRefresh() {
    const config = vscode.workspace.getConfiguration('usbDeviceTree');
    if (isAutoRefreshEnabled() && treeView.visible) {
      autoRefresh.start(config.get('refreshIntervalSeconds', 5) * 1000);
      if (process.platform === 'win32' && process.arch === 'x64') watcher.start();
    } else {
      autoRefresh.stop();
      watcher.stop();
    }
    void vscode.commands.executeCommand('setContext', 'usbDeviceTree.autoRefreshPaused', pauseState.paused);
    updateMessage();
  }

  function updateMessage() {
    treeView.message = viewStatus({
      searchEmpty: Boolean(provider.searchQuery.trim() && provider.nodes.length === 0),
      stale: provider.stale,
      staleReason: provider.staleReason,
      partialFailures: provider.partialFailures,
      autoRefreshRunning: autoRefresh.running,
      intervalSeconds: vscode.workspace.getConfiguration('usbDeviceTree').get('refreshIntervalSeconds', 5),
      visible: treeView.visible,
      enabled: isAutoRefreshEnabled(),
    });
  }

  function firstLeaf(node) {
    if (!node) return undefined;
    return node.children.length ? firstLeaf(node.children[0]) : node;
  }
}

function deactivate() {}

module.exports = { UsbDeviceTreeProvider, activate, deactivate, friendlyError };

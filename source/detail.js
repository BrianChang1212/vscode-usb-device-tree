function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fieldNames = {
  Status: 'Connection Status', Port: 'Physical Port', 'Connection status code': 'Connection Status Code',
  'Vendor ID': 'Vendor ID (VID)', 'Product ID': 'Product ID (PID)',
  Class: 'Device Class', Subclass: 'Subclass', Protocol: 'Protocol', Speed: 'USB Speed',
  'USB version': 'USB Version', 'Device version': 'Device Version',
  'Endpoint 0 max packet size': 'Endpoint 0 Max Packet Size',
  'Configuration count': 'Configuration Count', 'Device address': 'Device Address',
  'Open pipe count': 'Open Pipe Count', 'Current configuration value': 'Current Configuration Value',
  'Is hub': 'Is Hub', Manufacturer: 'Manufacturer', Product: 'Product',
  'Serial number': 'Serial Number', 'Hub port count': 'Hub Port Count',
  'Supported USB protocol bits': 'Supported USB Protocol Bits',
  'SuperSpeed operating': 'SuperSpeed Operating',
  'SuperSpeed capable': 'SuperSpeed Capable',
  'SuperSpeedPlus operating': 'SuperSpeedPlus Operating',
  'SuperSpeedPlus capable': 'SuperSpeedPlus Capable',
  'User connectable': 'User Connectable', 'Debug capable': 'Debug Capable',
  'Multiple companion ports': 'Multiple Companion Ports',
  'Type-C connector': 'Type-C Connector',
  'Companion port number': 'Companion Port Number', 'Companion hub': 'Companion Hub',
  'Driver key': 'Driver Key', Error: 'Query Error',
  'Serial port': 'COM Port', 'COM port': 'COM Port',
  'PnP instance ID': 'PnP Instance ID', 'Driver service': 'Driver Service',
};

const pnpNames = {
  pnpDescription: 'Device Description', pnpManufacturer: 'PnP Manufacturer',
  serviceName: 'Service Name', friendlyName: 'Friendly Name',
  locationInformation: 'Location Information', locationPaths: 'Location Paths',
  hardwareIds: 'Hardware IDs', compatibleIds: 'Compatible IDs',
  setupClass: 'Setup Class', classGuid: 'Class GUID',
  enumeratorName: 'Enumerator', kernelName: 'Kernel Name',
  pnpAddress: 'PnP Address', pnpCapabilities: 'PnP Capabilities',
  pnpConfigFlags: 'PnP Config Flags', devNodeStatus: 'Devnode Status',
  problemCode: 'Problem Code', driverInf: 'Driver INF',
  driverInfPath: 'Driver INF Path', driverKeyName: 'Driver Key',
  driverBinaryPath: 'Driver Binary Path',
  deviceInterfacePaths: 'Device Interface Paths',
  legacyBusType: 'Legacy Bus Type', lowerFilters: 'Lower Filters', upperFilters: 'Upper Filters',
  driverDescription: 'Driver Description', driverProvider: 'Driver Provider',
  driverVersion: 'Driver Version', driverDate: 'Driver Date',
  instanceId: 'Instance ID', childInstanceIds: 'Child Device IDs',
  containerId: 'Container ID', powerState: 'Power State',
};

function displayValue(key, value) {
  if (value === 'true') return 'Yes (true)';
  if (value === 'false') return 'No (false)';
  if (key === 'Status' && value === 'connected') return 'Connected (connected)';
  if (key === 'Status' && value === 'disconnected') return 'Disconnected (disconnected)';
  if (key === 'Speed') {
    const speeds = { low: 'Low Speed (1.5 Mb/s)', full: 'Full Speed (12 Mb/s)',
      high: 'High Speed (480 Mb/s)', super: 'SuperSpeed (5 Gb/s)',
      superPlus: 'SuperSpeedPlus' };
    return speeds[value] ? `${speeds[value]} [${value}]` : value;
  }
  return value;
}

function detailGroups(text) {
  const groups = { basic: [], descriptors: [], pnp: [], raw: [] };
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const companion = line.trim().match(/^Companion port (\d+) on (.+)$/);
    if (companion) {
      if (text.includes(`Companion port number: ${companion[1]}`) &&
          text.includes(`Companion hub: ${companion[2]}`)) continue;
      groups.basic.push([`Companion Port ${companion[1]}`, companion[2]]);
      continue;
    }
    const match = line.trim().match(/^([^:]+):\s*(.*)$/);
    const key = match ? match[1] : 'Description';
    const value = match ? match[2] : line.trim();
    if (key === 'Type') continue;
    const group = /descriptor bytes|BOS descriptor bytes/i.test(key) || /^(?:Descriptor \d+)$/.test(key)
      ? 'raw' : /^PnP |^Driver key$|^Driver service$|^Serial port$|^COM port$/.test(key)
        ? 'pnp' : /^(?:Configuration \d+|Interface|Endpoint|String descriptor|BOS capability|Supported speed)/.test(key)
          ? 'descriptors' : 'basic';
    const pathMatch = key.match(/^PnP deviceInterfacePath (\d+)$/);
    const friendlyKey = pathMatch ? `Device Path ${pathMatch[1]}` : key.startsWith('PnP ')
      ? pnpNames[key.slice(4)] || key.slice(4)
      : fieldNames[key] || key;
    groups[group].push([friendlyKey, displayValue(key, value)]);
  }
  return groups;
}

function renderRows(rows) {
  return `<dl class="fields">${rows.map(([name, value]) =>
    `<div class="field"><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
}

function renderSection(section) {
  const groups = detailGroups(section.text);
  const main = groups.basic.length ? renderRows(groups.basic) : '';
  const descriptors = groups.descriptors.length
    ? `<div class="subsection"><h3>Descriptors and Configurations</h3>${renderRows(groups.descriptors)}</div>` : '';
  const pnp = groups.pnp.length
    ? `<div class="subsection"><h3>Windows PnP and COM</h3>${renderRows(groups.pnp)}</div>` : '';
  const raw = groups.raw.length
    ? `<details class="raw"><summary>Raw Data</summary>${renderRows(groups.raw)}</details>` : '';
  return `<section class="device-section"><h2>${escapeHtml(section.title)}</h2>${main}${descriptors}${pnp}${raw}</section>`;
}

function renderDetailHtml(node) {
  const label = escapeHtml(node.label || 'USB Device');
  const sections = Array.isArray(node.detailSections) && node.detailSections.length
    ? node.detailSections : node.detailText ? [{ title: 'Details', text: node.detailText }] : [];
  const body = sections.length ? sections.map(renderSection).join('\n')
    : '<p class="empty">No details are available for this node.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${label}</title>
  <style>
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); margin: 0; padding: 24px clamp(16px, 4vw, 42px) 48px; font-size: 14px; line-height: 1.5; }
    main { max-width: 980px; margin: 0 auto; }
    h1 { font-size: 1.35rem; font-weight: 650; line-height: 1.35; margin: 0 0 24px; }
    h2 { font-size: 1.05rem; margin: 0 0 14px; }
    h3 { font-size: .9rem; font-weight: 600; margin: 0 0 10px; }
    .device-section { border-top: 1px solid var(--vscode-panel-border); padding: 22px 0 26px; }
    .subsection { margin-top: 22px; }
    .fields { margin: 0; }
    .field { display: grid; grid-template-columns: minmax(165px, 32%) minmax(0, 1fr); gap: 10px 18px; padding: 7px 0; border-bottom: 1px solid var(--vscode-panel-border); }
    dt { color: var(--vscode-descriptionForeground); }
    dd { margin: 0; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family); font-size: 13px; }
    .raw { margin-top: 20px; }
    summary { color: var(--vscode-textLink-foreground); cursor: pointer; padding: 8px 0; }
    summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
    .empty { color: var(--vscode-descriptionForeground); }
    @media (max-width: 550px) { .field { grid-template-columns: 1fr; gap: 2px; } }
  </style>
</head>
<body>
  <main><h1>${label}</h1>${body}</main>
</body>
</html>`;
}

class DetailsPanel {
  constructor(vscode, subscriptions = []) {
    this.vscode = vscode;
    this.panel = undefined;
    this.subscriptions = subscriptions;
  }

  show(node) {
    if (!this.panel) {
      this.panel = this.vscode.window.createWebviewPanel(
        'usbDeviceTree.details',
        'USB Device Details',
        this.vscode.ViewColumn.Beside,
        { enableScripts: false, retainContextWhenHidden: false },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.subscriptions.push(this.panel);
    }

    this.panel.title = node.label || 'USB Device Details';
    this.panel.webview.html = renderDetailHtml(node);
    this.panel.reveal(this.vscode.ViewColumn.Beside, true);
  }
}

module.exports = { DetailsPanel, escapeHtml, renderDetailHtml };

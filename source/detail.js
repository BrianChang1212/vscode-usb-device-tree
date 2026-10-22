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
  return `<section class="device-section"><h2>${escapeHtml(section.title)}</h2>${main}${descriptors}</section>`;
}

function renderTabSections(sections, kind) {
  if (kind === 'pnp' || kind === 'raw') {
    const rows = sections.flatMap((section) => detailGroups(section.text)[kind]);
    return rows.length ? `<section class="device-section"><h2>${kind === 'pnp' ? 'Windows PnP and COM' : 'Raw Data'}</h2>${renderRows(rows)}</section>`
      : '<p class="empty">No data is available in this category.</p>';
  }
  const selected = sections.filter((section) =>
    (section.title.toLowerCase().includes('physical port') ? 'port' : 'device') === kind);
  return selected.length ? selected.map(renderSection).join('\n')
    : '<p class="empty">No data is available in this category.</p>';
}

function deviceSummary(node) {
  const label = escapeHtml(node.label || 'USB Device');
  const status = String(node.status || 'unknown').toUpperCase();
  const vid = Number.isInteger(node.vendorId) ? node.vendorId.toString(16).padStart(4, '0') : '----';
  const pid = Number.isInteger(node.productId) ? node.productId.toString(16).padStart(4, '0') : '----';
  const port = Number.isInteger(node.port) ? `PORT ${String(node.port).padStart(2, '0')}` : 'USB DEVICE';
  const speeds = { low: 'Low Speed', full: 'Full Speed', high: 'High Speed',
    super: 'SuperSpeed', superPlus: 'SuperSpeedPlus' };
  const facts = [];
  if (node.speed) facts.push(['USB SPEED', speeds[node.speed] || node.speed]);
  if (Number.isInteger(node.deviceClass)) {
    const classLine = String(node.detailText || '').match(/^Class: (.+)$/m);
    facts.push(['DEVICE CLASS', classLine ? classLine[1] : `0x${node.deviceClass.toString(16).padStart(2, '0')}`]);
  }
  const metrics = facts.length ? `<div class="hero-facts">${facts.map(([name, value]) =>
    `<div class="fact"><span>${name}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>` : '';
  return `<header class="device-hero"><div class="eyebrow"><span>${port}</span><span class="state ${escapeHtml(status.toLowerCase())}"><i></i>${escapeHtml(status)}</span></div><h1>${label}</h1><div class="hero-meta"><span>VID ${vid}</span><span>PID ${pid}</span></div>${metrics}</header>`;
}

function renderDetailHtml(node) {
  const sections = Array.isArray(node.detailSections) && node.detailSections.length
    ? node.detailSections : node.detailText ? [{ title: 'Details', text: node.detailText }] : [];
  const hasPort = sections.some((section) => section.title.toLowerCase().includes('physical port'));
  const tabs = [['port', 'Physical Port'], ['device', 'USB Device'], ['pnp', 'Windows PnP'], ['raw', 'Raw Data']];
  const body = sections.length ? `<div class="detail-tabs" role="group" aria-label="Detail category">${tabs.map(([id, title]) =>
    `<input type="radio" id="tab-${id}" name="detail-category" ${id === (hasPort ? 'port' : 'device') ? 'checked' : ''}><label for="tab-${id}">${title}</label>`).join('')}</div>${tabs.map(([id]) =>
      `<div class="tab-panel" id="panel-${id}">${renderTabSections(sections, id)}</div>`).join('')}`
    : '<p class="empty">No details are available for this node.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(node.label || 'USB Device')}</title>
  <style>
    :root { color-scheme: dark; --surface: #080d0a; --panel: #111b14; --raised: #1b2a20; --line: #31513a; --muted: #a4c3aa; --text: #e5f5e8; --accent: #89e829; }
    * { box-sizing: border-box; }
    body { color: var(--text); background: radial-gradient(ellipse at 95% 0%, #16402344, transparent 37%), var(--surface); font-family: var(--vscode-font-family, 'Segoe UI', sans-serif); margin: 0; font-size: 14px; line-height: 1.65; }
    main { max-width: 1120px; margin: 0 auto; padding: 26px clamp(16px, 4vw, 44px) 56px; }
    .device-hero { background: linear-gradient(145deg, #16251aee, #0e1812f2); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 6px; padding: 22px 26px; margin-bottom: 20px; box-shadow: inset 0 1px #b4ff7f14, 0 10px 24px #0004; }
    .eyebrow, .hero-meta { display: flex; flex-wrap: wrap; gap: 10px 20px; color: var(--muted); font: 700 11px/1.3 Consolas, monospace; letter-spacing: .12em; }
    .hero-facts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
    .fact { min-width: 140px; flex: 1; background: var(--panel); border: 1px solid var(--line); border-radius: 5px; padding: 11px 13px; }
    .fact span { display: block; color: var(--muted); font: 700 10px Consolas, monospace; letter-spacing: .1em; }
    .fact strong { display: block; color: var(--text); font-size: 13px; margin-top: 5px; overflow-wrap: anywhere; }
    .eyebrow { justify-content: space-between; }
    .state { color: var(--accent); display: inline-flex; align-items: center; gap: 7px; }
    .state:not(.connected) { color: #b2bbb2; }
    .state i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    h1 { font-family: Consolas, 'Cascadia Code', monospace; font-size: clamp(20px, 3vw, 31px); font-weight: 700; line-height: 1.25; margin: 16px 0; overflow-wrap: anywhere; }
    h2 { color: var(--accent); font-size: 12px; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 20px; }
    h3 { font-size: 12px; font-weight: 650; margin: 20px 0 10px; }
    .detail-tabs { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--line); }
    .detail-tabs input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .detail-tabs label { white-space: nowrap; color: var(--muted); background: var(--raised); border: 1px solid var(--line); border-radius: 4px 4px 0 0; padding: 10px 14px; cursor: pointer; font-size: 12px; font-weight: 650; }
    .detail-tabs label:hover { color: var(--text); }
    .detail-tabs input:checked + label { color: var(--surface); background: var(--accent); border-color: var(--accent); font-weight: 700; }
    .detail-tabs input:focus-visible + label { outline: 2px solid var(--accent); outline-offset: -3px; }
    .tab-panel { display: none; }
    main:has(#tab-port:checked) #panel-port, main:has(#tab-device:checked) #panel-device, main:has(#tab-pnp:checked) #panel-pnp, main:has(#tab-raw:checked) #panel-raw { display: block; }
    .device-section { background: linear-gradient(145deg, #16251aee, #0e1812f2); border: 1px solid var(--line); border-radius: 6px; padding: 24px; margin-top: 20px; box-shadow: inset 0 1px #b4ff7f14, 0 10px 24px #0004; }
    .subsection { margin-top: 22px; }
    .fields { margin: 0; }
    .field { display: grid; grid-template-columns: minmax(165px, 32%) minmax(0, 1fr); gap: 10px 18px; padding: 9px 0; border-bottom: 1px solid var(--line); }
    .field:last-child { border-bottom: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; overflow-wrap: anywhere; font-family: Consolas, var(--vscode-editor-font-family, monospace); font-size: 13px; }
    .raw { margin-top: 20px; }
    summary { color: var(--accent); cursor: pointer; padding: 8px 0; }
    summary:focus-visible { outline: 2px solid var(--accent); }
    .empty { color: var(--muted); padding: 24px 0; }
    @media (max-width: 550px) { .field { grid-template-columns: 1fr; gap: 2px; } .device-hero, .device-section { padding: 18px; } }
  </style>
</head>
<body>
  <main>${deviceSummary(node)}${body}</main>
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

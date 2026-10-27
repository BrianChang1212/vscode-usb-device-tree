const { englishT, htmlLang, translator } = require('./l10n');
const { guideCss } = require('./style');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Display names for the English detail-line keys produced by tree.js nodeDetail(). Keys stay English
// (they are parsed and searched); only the rendered labels are translated.
function fieldNames(t) {
  return {
    Status: t('Connection Status'), Port: t('Physical Port'), 'Connection status code': t('Connection Status Code'),
    'Vendor ID': t('Vendor ID (VID)'), 'Product ID': t('Product ID (PID)'),
    Class: t('Device Class'), Subclass: t('Subclass'), Protocol: t('Protocol'), Speed: t('USB Speed'),
    'USB version': t('USB Version'), 'Device version': t('Device Version'),
    'Endpoint 0 max packet size': t('Endpoint 0 Max Packet Size'),
    'Configuration count': t('Configuration Count'), 'Device address': t('Device Address'),
    'Open pipe count': t('Open Pipe Count'), 'Current configuration value': t('Current Configuration Value'),
    'Is hub': t('Is Hub'), Manufacturer: t('Manufacturer'), Product: t('Product'),
    'Serial number': t('Serial Number'), 'Hub port count': t('Hub Port Count'),
    'Friendly name': t('Friendly Name'), 'Hub symbolic link': t('Hub Symbolic Link'),
    'Hub characteristics': t('Hub Characteristics'),
    'Hub power-on delay (2 ms units)': t('Hub Power-on Delay (2 ms units)'),
    'Hub control current (mA)': t('Hub Control Current (mA)'),
    'Supported USB protocol bits': t('Supported USB Protocol Bits'),
    'SuperSpeed operating': t('SuperSpeed Operating'),
    'SuperSpeed capable': t('SuperSpeed Capable'),
    'SuperSpeedPlus operating': t('SuperSpeedPlus Operating'),
    'SuperSpeedPlus capable': t('SuperSpeedPlus Capable'),
    'User connectable': t('User Connectable'), 'Debug capable': t('Debug Capable'),
    'Multiple companion ports': t('Multiple Companion Ports'),
    'Type-C connector': t('Type-C Connector'),
    'Companion port number': t('Companion Port Number'), 'Companion hub': t('Companion Hub'),
    'Driver key': t('Driver Key'), Error: t('Query Error'),
    'Serial port': t('COM Port'), 'COM port': t('COM Port'),
    'PnP instance ID': t('PnP Instance ID'), 'Driver service': t('Driver Service'),
    Description: t('Description'),
  };
}

function pnpNames(t) {
  return {
    pnpDescription: t('Device Description'), pnpManufacturer: t('PnP Manufacturer'),
    serviceName: t('Service Name'), friendlyName: t('Friendly Name'),
    locationInformation: t('Location Information'), locationPaths: t('Location Paths'),
    hardwareIds: t('Hardware IDs'), compatibleIds: t('Compatible IDs'),
    setupClass: t('Setup Class'), classGuid: t('Class GUID'),
    enumeratorName: t('Enumerator'), kernelName: t('Kernel Name'),
    pnpAddress: t('PnP Address'), pnpCapabilities: t('PnP Capabilities'),
    pnpConfigFlags: t('PnP Config Flags'), devNodeStatus: t('Devnode Status'),
    problemCode: t('Problem Code'), driverInf: t('Driver INF'),
    driverInfPath: t('Driver INF Path'), driverKeyName: t('Driver Key'),
    driverBinaryPath: t('Driver Binary Path'),
    deviceInterfacePaths: t('Device Interface Paths'),
    legacyBusType: t('Legacy Bus Type'), lowerFilters: t('Lower Filters'), upperFilters: t('Upper Filters'),
    driverDescription: t('Driver Description'), driverProvider: t('Driver Provider'),
    driverVersion: t('Driver Version'), driverDate: t('Driver Date'),
    instanceId: t('Instance ID'), childInstanceIds: t('Child Device IDs'),
    containerId: t('Container ID'), powerState: t('Power State'),
  };
}

// Section titles come from tree.js in English; translate the known ones, keep anything else as-is.
function sectionTitle(title, t) {
  const titles = { 'Physical Port': t('Physical Port'), 'USB Device': t('USB Device'), 'Host Controller': t('Host Controller'),
    Hub: t('Hub'), 'COM Port': t('COM Port'), Details: t('Details') };
  const downstream = String(title).match(/^Downstream Hub: (.+)$/);
  return downstream ? t('Downstream Hub: {0}', downstream[1]) : titles[title] || title;
}

// USB speed names (Low/Full/High Speed, SuperSpeed) are USB specification terms and stay English.
function displayValue(key, value, t) {
  if (value === 'true') return t('Yes (true)');
  if (value === 'false') return t('No (false)');
  if (key === 'Status' && value === 'connected') return t('Connected (connected)');
  if (key === 'Status' && value === 'disconnected') return t('Disconnected (disconnected)');
  if (key === 'Speed') {
    const speeds = { low: 'Low Speed (1.5 Mb/s)', full: 'Full Speed (12 Mb/s)',
      high: 'High Speed (480 Mb/s)', super: 'SuperSpeed (5 Gb/s)',
      superPlus: 'SuperSpeedPlus' };
    return speeds[value] ? `${speeds[value]} [${value}]` : value;
  }
  return value;
}

function detailGroups(text, t = englishT) {
  const fields = fieldNames(t);
  const pnp = pnpNames(t);
  const groups = { basic: [], descriptors: [], pnp: [], raw: [] };
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const companion = line.trim().match(/^Companion port (\d+) on (.+)$/);
    if (companion) {
      if (text.includes(`Companion port number: ${companion[1]}`) &&
          text.includes(`Companion hub: ${companion[2]}`)) continue;
      groups.basic.push([t('Companion Port {0}', companion[1]), companion[2]]);
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
    const friendlyKey = pathMatch ? t('Device Path {0}', pathMatch[1]) : key.startsWith('PnP ')
      ? pnp[key.slice(4)] || key.slice(4)
      : fields[key] || key;
    groups[group].push([friendlyKey, displayValue(key, value, t)]);
  }
  return groups;
}

function renderRows(rows) {
  return `<dl class="fields">${rows.map(([name, value]) =>
    `<div class="field"><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
}

function renderSection(section, t) {
  const groups = detailGroups(section.text, t);
  const main = groups.basic.length ? renderRows(groups.basic) : '';
  const descriptors = groups.descriptors.length
    ? `<div class="subsection"><h3>${escapeHtml(t('Descriptors and Configurations'))}</h3>${renderRows(groups.descriptors)}</div>` : '';
  return `<section class="device-section"><h2>${escapeHtml(sectionTitle(section.title, t))}</h2>${main}${descriptors}</section>`;
}

function renderTabSections(sections, kind, t) {
  const empty = `<p class="empty">${escapeHtml(t('No data is available in this category.'))}</p>`;
  if (kind === 'pnp' || kind === 'raw') {
    const rows = sections.flatMap((section) => detailGroups(section.text, t)[kind]);
    const title = kind === 'pnp' ? t('Windows PnP and COM') : t('Raw Data');
    return rows.length ? `<section class="device-section"><h2>${escapeHtml(title)}</h2>${renderRows(rows)}</section>` : empty;
  }
  const selected = sections.filter((section) =>
    (section.title.toLowerCase().includes('physical port') ? 'port' : 'device') === kind);
  return selected.length ? selected.map((section) => renderSection(section, t)).join('\n') : empty;
}

function deviceSummary(node, t) {
  const label = escapeHtml(node.label || t('USB Device'));
  const statusCode = String(node.status || 'unknown');
  const statusText = statusCode === 'connected' ? t('CONNECTED') : statusCode === 'disconnected'
    ? t('DISCONNECTED') : statusCode.toUpperCase();
  const vid = Number.isInteger(node.vendorId) ? node.vendorId.toString(16).padStart(4, '0') : '----';
  const pid = Number.isInteger(node.productId) ? node.productId.toString(16).padStart(4, '0') : '----';
  const port = Number.isInteger(node.port) ? t('PORT {0}', String(node.port).padStart(2, '0')) : t('USB DEVICE');
  const speeds = { low: 'Low Speed', full: 'Full Speed', high: 'High Speed',
    super: 'SuperSpeed', superPlus: 'SuperSpeedPlus' };
  const facts = [];
  if (node.speed) facts.push([t('USB SPEED'), speeds[node.speed] || node.speed]);
  if (Number.isInteger(node.deviceClass)) {
    const classLine = String(node.detailText || '').match(/^Class: (.+)$/m);
    facts.push([t('DEVICE CLASS'), classLine ? classLine[1] : `0x${node.deviceClass.toString(16).padStart(2, '0')}`]);
  }
  const metrics = facts.length ? `<div class="hero-facts">${facts.map(([name, value]) =>
    `<div class="fact"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>` : '';
  return `<header class="device-hero"><div class="eyebrow"><span>${escapeHtml(port)}</span><span class="state ${escapeHtml(statusCode.toLowerCase())}"><i></i>${escapeHtml(statusText)}</span></div><h1>${label}</h1><div class="hero-meta"><span>VID ${vid}</span><span>PID ${pid}</span></div>${metrics}</header>`;
}

const DETAIL_CSS = `
main { max-width: 1120px; margin: 0 auto; padding: 26px clamp(16px, 4vw, 44px) 56px; }
body { font-size: 14px; line-height: 1.65; }
.device-hero { background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 6px; padding: 22px 26px; margin-bottom: 20px; }
.eyebrow, .hero-meta { display: flex; flex-wrap: wrap; gap: 10px 20px; margin: 0; color: var(--muted); font: 700 11px/1.3 var(--mono); letter-spacing: .12em; }
.eyebrow { justify-content: space-between; }
.hero-facts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.fact { min-width: 140px; flex: 1; background: var(--raised); border: 1px solid var(--line); border-radius: 5px; padding: 11px 13px; }
.fact span { display: block; color: var(--muted); font: 700 10px var(--mono); letter-spacing: .1em; }
.fact strong { display: block; color: var(--text); font-size: 13px; margin-top: 5px; overflow-wrap: anywhere; }
.state { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); }
.state.connected { color: var(--accent); }
.state.disconnected { color: var(--danger); }
.state i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
h1 { font-size: clamp(20px, 3vw, 31px); line-height: 1.25; margin: 16px 0; overflow-wrap: anywhere; }
h2 { color: var(--accent); font-size: 12px; letter-spacing: .12em; margin: 0 0 20px; }
h3 { font-size: 12px; font-weight: 650; margin: 20px 0 10px; }
.detail-tabs { display: flex; gap: 4px; overflow-x: auto; border-bottom: 1px solid var(--line); }
.detail-tabs input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.detail-tabs label { white-space: nowrap; color: var(--muted); background: var(--raised); border: 1px solid var(--line); border-radius: 4px 4px 0 0; padding: 10px 14px; cursor: pointer; font-size: 12px; font-weight: 650; }
.detail-tabs label:hover { color: var(--text); }
.detail-tabs input:checked + label { color: var(--accent-fg); background: var(--accent); border-color: var(--accent); font-weight: 700; }
.detail-tabs input:focus-visible + label { outline: 2px solid var(--focus); outline-offset: -3px; }
.tab-panel { display: none; }
main:has(#tab-port:checked) #panel-port, main:has(#tab-device:checked) #panel-device, main:has(#tab-pnp:checked) #panel-pnp, main:has(#tab-raw:checked) #panel-raw { display: block; }
.device-section { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 24px; margin-top: 20px; }
.subsection { margin-top: 22px; }
.fields { margin: 0; }
.field { display: grid; grid-template-columns: minmax(165px, 32%) minmax(0, 1fr); gap: 10px 18px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.field:last-child { border-bottom: 0; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; font-family: var(--mono); font-size: 13px; }
.empty { margin-top: 20px; }
@media (max-width: 550px) { .field { grid-template-columns: 1fr; gap: 2px; } .device-hero, .device-section { padding: 18px; } }
`;

function renderDetailHtml(node, t = englishT, language = 'en') {
  const sections = Array.isArray(node.detailSections) && node.detailSections.length
    ? node.detailSections : node.detailText ? [{ title: 'Details', text: node.detailText }] : [];
  const hasPort = sections.some((section) => section.title.toLowerCase().includes('physical port'));
  const tabs = [['port', t('Physical Port')], ['device', t('USB Device')], ['pnp', t('Windows PnP')], ['raw', t('Raw Data')]];
  const body = sections.length ? `<div class="detail-tabs" role="group" aria-label="${escapeHtml(t('Detail category'))}">${tabs.map(([id, title]) =>
    `<input type="radio" id="tab-${id}" name="detail-category" ${id === (hasPort ? 'port' : 'device') ? 'checked' : ''}><label for="tab-${id}">${escapeHtml(title)}</label>`).join('')}</div>${tabs.map(([id]) =>
      `<div class="tab-panel" id="panel-${id}">${renderTabSections(sections, id, t)}</div>`).join('')}`
    : `<p class="empty">${escapeHtml(t('No details are available for this node.'))}</p>`;

  return `<!doctype html>
<html lang="${htmlLang(language)}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(node.label || t('USB Device'))}</title>
  <style>${guideCss('editor')}${DETAIL_CSS}</style>
</head>
<body>
  <main>${deviceSummary(node, t)}${body}</main>
</body>
</html>`;
}

class DetailsPanel {
  constructor(vscode, subscriptions = []) {
    this.vscode = vscode;
    this.t = translator(vscode);
    this.panel = undefined;
    this.subscriptions = subscriptions;
  }

  show(node) {
    const t = this.t;
    if (!this.panel) {
      this.panel = this.vscode.window.createWebviewPanel(
        'usbDeviceTree.details',
        t('USB Device Details'),
        this.vscode.ViewColumn.Beside,
        { enableScripts: false, retainContextWhenHidden: false },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.subscriptions.push(this.panel);
    }

    this.panel.title = node.label || t('USB Device Details');
    this.panel.webview.html = renderDetailHtml(node, t, this.vscode.env?.language);
    this.panel.reveal(this.vscode.ViewColumn.Beside, true);
  }
}

module.exports = { DetailsPanel, escapeHtml, renderDetailHtml };

const assert = require('node:assert/strict');
const test = require('node:test');

const { renderDetailHtml } = require('../source/detail');

test('renders a themed device summary and accessible detail tabs', () => {
  const html = renderDetailHtml({ label: 'Port 5: Radio', port: 5, status: 'connected',
    vendorId: 0x0489, productId: 0xe122, speed: 'full', deviceClass: 0xe0,
    detailSections: [
      { title: 'Physical Port', text: 'Status: connected\nPort: 5' },
      { title: 'USB Device', text: 'Speed: full\nVendor ID: 0x0489\nPnP driverInf: oem42.inf\nDevice descriptor bytes: 1201' },
    ] });
  assert.match(html, /class="device-hero"/);
  assert.match(html, /VID 0489/);
  assert.match(html, /USB SPEED/);
  assert.match(html, /Full Speed/);
  assert.match(html, /DEVICE CLASS/);
  assert.match(html, /class="detail-tabs" role="group"/);
  assert.match(html, /Physical Port/);
  assert.match(html, /USB Device/);
  assert.match(html, /Windows PnP/);
  assert.match(html, /Raw Data/);
  assert.match(html, /--base: var\(--vscode-editor-background\)/);
});

test('renders node labels and device details as escaped, script-free HTML', () => {
  const html = renderDetailHtml({
    label: '<img src=x onerror=alert(1)>',
    detailText: '</pre><script>alert(1)</script>& device details',
  });

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script\b/i);
});

test('shows an explicit message when a node has no detail text', () => {
  const html = renderDetailHtml({ label: 'Example device', detailText: '' });

  assert.match(html, /No details are available for this node/);
});

test('separates a connected physical port, USB descriptors, and PnP details', () => {
  const html = renderDetailHtml({
    label: 'Port 1: Example Serial Adapter (COM41)', port: 1, status: 'connected',
    vendorId: 0xcafe, productId: 1,
    detailSections: [
      { title: 'Physical Port', text: 'Type: port\nStatus: connected\nPort: 1\nSupported USB protocol bits: 3' },
      { title: 'USB Device', text: 'Type: device\nSpeed: full\nVendor ID: 0xcafe\nProduct ID: 0x0001\nSerial port: COM41 (Example Serial Adapter)\nConfiguration 0: value=1, interfaces=2\n  Interface: number=0, class=0x02; raw=0904\nPnP setupClass: Ports\nPnP driverInf: oem42.inf\nDevice descriptor bytes: 1201' },
    ],
  });
  assert.match(html, /<h2>Physical Port<\/h2>/);
  assert.match(html, /<h2>USB Device<\/h2>/);
  assert.match(html, /Descriptors and Configurations/);
  assert.match(html, /Windows PnP and COM/);
  assert.match(html, /Raw Data/);
  assert.match(html, /COM41/);
  assert.match(html, /Full Speed/);
  assert.match(html, /oem42\.inf/);
  assert.doesNotMatch(html, /<pre>Type: port/);
});

test('escapes values inside structured sections and preserves unknown fields', () => {
  const html = renderDetailHtml({ label: 'USB <device>',
    detailSections: [{ title: 'USB <device>', text: 'PnP driverDescription: A&B <serial>\nCustom field: <script>alert(1)</script>' }],
  });
  assert.match(html, /USB &lt;device&gt;/);
  assert.match(html, /A&amp;B &lt;serial&gt;/);
  assert.match(html, /Custom field/);
  assert.doesNotMatch(html, /<script\b/i);
});

test('shows container, power state, and child IDs with readable PnP labels', () => {
  const html = renderDetailHtml({ label: 'Example device', detailSections: [{ title: 'USB device',
    text: 'PnP containerId: {01234567-89ab-cdef-0123-456789abcdef}\nPnP powerState: D0\nPnP childInstanceIds: USB\\VID_1234' }] });
  assert.match(html, /Container ID/);
  assert.match(html, /Power State/);
  assert.match(html, /Child Device IDs/);
});

test('labels verified INF paths and child driver keys without losing their values', () => {
  const html = renderDetailHtml({ label: 'USB child', detailSections: [{ title: 'PnP child',
    text: 'PnP driverInfPath: C:\\Windows\\INF\\oem42.inf\nPnP driverKeyName: {class}\\0001\nPnP driverBinaryPath: \\SystemRoot\\System32\\drivers\\usbser.sys' }] });
  assert.match(html, /Driver INF Path/);
  assert.match(html, /C:\\Windows\\INF\\oem42\.inf/);
  assert.match(html, /Driver Key/);
  assert.match(html, /Driver Binary Path/);
});

test('labels separate device interface paths in the detail panel', () => {
  const html = renderDetailHtml({ label: 'USB child', detailSections: [{ title: 'PnP child',
    text: 'PnP deviceInterfacePath 1: \\\\?\\USB#ONE\nPnP deviceInterfacePath 2: \\\\?\\USB#TWO' }] });
  assert.match(html, /Device Path 1/);
  assert.match(html, /Device Path 2/);
});

test('does not repeat an already listed companion port as an unlabeled note', () => {
  const html = renderDetailHtml({ label: 'Port 1', detailSections: [{ title: 'Physical Port',
    text: 'Companion port number: 6\nCompanion hub: USB#ROOT_HUB\nCompanion port 6 on USB#ROOT_HUB' }] });
  assert.equal((html.match(/USB#ROOT_HUB/g) || []).length, 1);
  assert.doesNotMatch(html, /<dt>Description<\/dt>/);
});

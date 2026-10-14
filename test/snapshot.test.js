const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSnapshot, exportSnapshot } = require('../source/snapshot');

test('creates project-specific XML for empty and connected ports with escaped values', () => {
  const xml = createSnapshot({ controllers: [{
    type: 'controller', name: 'Controller & <One>', children: [{
      type: 'hub', name: 'Root "Hub"', ports: [
        { type: 'port', port: 1, status: 'disconnected', companions: [{ index: 0, portNumber: 9, hub: 'Hub<&>' }], children: [] },
        { type: 'port', port: 2, status: 'connected', children: [{
          type: 'device', name: "Device's", product: 'Scanner', manufacturer: 'A&B',
          serialNumber: '<serial>', vendorId: 10, productId: 20,
          usbVersion: 768, deviceDescriptorHex: '12010003',
          bosDescriptorHex: '050F160002071002020000000A1003000E0001010200',
          deviceAddress: 9, openPipeCount: 2, currentConfigurationValue: 1,
          stringDescriptors: [{ index: 2, languageId: 1033, value: 'Scan & OCR' }],
          pnpProperties: { pnpDescription: 'Scanner & camera' },
          configurationDescriptors: [{ index: 0, value: 1, descriptorHex: '0902', descriptors: [
            { type: 5, endpointAddress: 129, direction: 'IN', rawHex: '070581' },
          ] }], children: [],
        }] },
      ],
    }],
  }] }, { generatedAt: '2026-10-14T00:00:00Z' }).toString('utf8');

  assert.match(xml, /<UsbDeviceTreeSnapshot version="1"/);
  assert.match(xml, /Controller &amp; &lt;One&gt;/);
  assert.match(xml, /name="Root &quot;Hub&quot;"/);
  assert.match(xml, /name="Device&apos;s"/);
  assert.match(xml, /manufacturer="A&amp;B"/);
  assert.match(xml, /product="Scanner"/);
  assert.match(xml, /serialNumber="&lt;serial&gt;"/);
  assert.match(xml, /<Configuration index="0" value="1" descriptorHex="0902">[\s\S]*<Descriptor type="5" endpointAddress="129" direction="IN" rawHex="070581" \/>[\s\S]*<\/Configuration>/);
  assert.match(xml, /deviceDescriptorHex="12010003"/);
  assert.match(xml, /<BOSCapability name="USB 2\.0 Extension"/);
  assert.match(xml, /<SupportedSpeed name="SuperSpeed" \/>/);
  assert.match(xml, /<StringDescriptor index="2" languageId="1033" value="Scan &amp; OCR" \/>/);
  assert.match(xml, /<PnpProperties pnpDescription="Scanner &amp; camera" \/>/);
  assert.match(xml, /<Companion index="0" portNumber="9" hub="Hub&lt;&amp;&gt;" \/>/);
  assert.match(xml, /port="1" status="disconnected"/);
});

test('canceling the save dialog does not write a snapshot', async () => {
  let writes = 0;
  const vscode = { window: { showSaveDialog: async () => undefined } };

  const saved = await exportSnapshot(vscode, Buffer.from('<report />'), {
    async writeFile() {
      writes += 1;
    },
  });

  assert.equal(saved, false);
  assert.equal(writes, 0);
});

test('exports structured serial ports with XML escaping and no invented port for empty devices', () => {
  const xml = createSnapshot({ controllers: [{
    type: 'controller', children: [{ type: 'device', name: 'Composite', serialPorts: [
      { portName: 'COM41', friendlyName: 'A&B <Serial>', instanceId: 'USB\\VID_CAFE&PID_0001\\0', serviceName: 'usbser' },
      { portName: 'COM42', friendlyName: 'Second serial port', instanceId: 'USB\\VID_CAFE&PID_0001\\2' },
    ] }, { type: 'device', name: 'No COM' }] }],
  }, { generatedAt: '2026-10-14T00:00:00Z' }).toString('utf8');
  assert.match(xml, /<SerialPort portName="COM41" friendlyName="A&amp;B &lt;Serial&gt;" instanceId="USB\\VID_CAFE&amp;PID_0001\\0" serviceName="usbser" \/>/);
  assert.match(xml, /<SerialPort portName="COM42"/);
  assert.equal((xml.match(/<SerialPort /g) || []).length, 2);
  assert.match(xml, /<Node type="device" name="No COM" \/>/);
});

test('preserves setup, status, and driver registry fields in the project XML', () => {
  const xml = createSnapshot({ controllers: [{
    type: 'controller', children: [{ type: 'device', name: 'Serial adapter',
      pnpProperties: { setupClass: 'Ports', driverInf: 'oem42.inf',
        devNodeStatus: '0x180200a', problemCode: '0',
        driverDescription: 'Adapter & serial' } }],
  }] }, { generatedAt: '2026-10-14T00:00:00Z' }).toString('utf8');
  assert.match(xml, /<PnpProperties[^>]*setupClass="Ports"[^>]*driverInf="oem42\.inf"/);
  assert.match(xml, /devNodeStatus="0x180200a" problemCode="0"/);
  assert.match(xml, /driverDescription="Adapter &amp; serial"/);
});

test('exports container, power state, and child IDs from the same PnP record', () => {
  const xml = createSnapshot({ controllers: [{ type: 'controller', children: [{ type: 'device',
    pnpProperties: { containerId: '{01234567-89ab-cdef-0123-456789abcdef}',
      powerState: 'D0', childInstanceIds: 'USB\\VID_1234&PID_ABCD\\child' } }] }] });
  assert.match(xml.toString('utf8'), /containerId="\{01234567-89ab-cdef-0123-456789abcdef\}"/);
  assert.match(xml.toString('utf8'), /powerState="D0"/);
  assert.match(xml.toString('utf8'), /childInstanceIds="USB\\VID_1234&amp;PID_ABCD\\child"/);
});

test('exports USB4 PnP children and interface paths without invented hub ports', () => {
  const xml = createSnapshot({ controllers: [{ type: 'controller', name: 'USB4 Host Router',
    children: [{ type: 'pnpDevice', name: 'USB4 Root Device Router',
      pnpProperties: { deviceInterfacePaths: '\\\\?\\USB4#ONE&GUID' }, children: [] }] }] });
  const text = xml.toString('utf8');
  assert.match(text, /<Node type="controller" name="USB4 Host Router">/);
  assert.match(text, /<Node type="pnpDevice" name="USB4 Root Device Router">/);
  assert.match(text, /deviceInterfacePaths="\\\\\?\\USB4#ONE&amp;GUID"/);
  assert.doesNotMatch(text, /type="hub"|type="port"/);
});

test('exports the exact original XML bytes to the user-selected path', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'usb-device-tree-snapshot-test-'));
  const outputPath = path.join(directory, 'selected-report.xml');
  const rawXml = Buffer.from('\uFEFF<?xml version="1.0" encoding="utf-8"?><report>USB &amp; devices</report>', 'utf8');
  const vscode = {
    window: {
      async showSaveDialog(options) {
        assert.deepEqual(options.filters, { 'XML reports': ['xml'] });
        return { fsPath: outputPath };
      },
    },
  };

  try {
    assert.equal(await exportSnapshot(vscode, rawXml), true);
    assert.deepEqual(await fs.readFile(outputPath), rawXml);
  } finally {
    await fs.unlink(outputPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await fs.rmdir(directory);
  }
});

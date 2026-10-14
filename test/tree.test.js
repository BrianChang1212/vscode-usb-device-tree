const assert = require('node:assert/strict');
const test = require('node:test');

const { filterTreeNodes, nodeDetail, toTreeNodes } = require('../source/tree');

const fixture = {
  controllers: [{
    type: 'controller',
    name: 'USB Host Controller',
    children: [{
      type: 'hub',
      name: 'Root Hub',
      ports: [
        { type: 'port', port: 1, status: 'disconnected', companions: [{ index: 0, portNumber: 9, hub: 'USB#Companion' }], children: [] },
        { type: 'port', port: 2, status: 'connected', children: [{
          type: 'device', name: 'USB device', manufacturer: 'Acme', product: 'Camera',
          serialNumber: 'SN<&1', vendorId: 0x1234, productId: 0xabcd,
          speed: 'high', usbVersion: 0x0300, deviceVersion: 0x0101,
          deviceAddress: 4, openPipeCount: 3, currentConfigurationValue: 1, deviceIsHub: false,
          deviceDescriptorHex: '12010003', bosDescriptorHex: '050F160002071002020000000A1003000E0001010200',
          stringDescriptors: [{ index: 2, languageId: 1033, value: 'Cam & Mic' }],
          driverKeyName: 'USB\\VID_1234&PID_ABCD',
          pnpProperties: { pnpDescription: 'Camera & microphone', serviceName: 'usbvideo' },
          configurationDescriptors: [{ index: 0, value: 1, interfaceCount: 2, attributes: 128, maxPower: 50, descriptorHex: '09022000', descriptors: [
            { type: 4, interfaceNumber: 1, alternateSetting: 0, endpointCount: 1, class: 3, subclass: 1, protocol: 2, rawHex: '09040100' },
            { type: 5, endpointAddress: 129, direction: 'IN', transferType: 'Interrupt', attributes: 3, maxPacketSize: 64, interval: 10, rawHex: '0705810300400A' },
          ] }],
          children: [],
        }] },
      ],
    }],
  }],
};

test('maps controller, hub, physical ports, and devices to stable tree paths', () => {
  const tree = toTreeNodes(fixture.controllers);

  assert.equal(tree[0].id, '0');
  assert.equal(tree[0].label, 'USB Host Controller');
  const hub = tree[0].children[0];
  assert.equal(hub.id, '0.0');
  assert.equal(hub.label, 'Root Hub');
  assert.equal(hub.children[0].label, 'Port 1: disconnected');
  assert.equal(hub.children[1].id, '0.0.1');
  assert.match(hub.children[1].label, /VID_1234&PID_abcd/);
  assert.match(hub.children[1].detailText, /Speed: high/);
  assert.match(hub.children[1].detailText, /USB version: 3\.00 \(0x0300\)/);
  assert.match(hub.children[1].label, /Acme Camera/);
  assert.match(hub.children[1].detailText, /Manufacturer: Acme/);
  assert.match(hub.children[1].detailText, /Device descriptor bytes: 12010003/);
  assert.match(hub.children[1].detailText, /BOS capability: USB 2\.0 Extension \(lpmSupported=true/);
  assert.match(hub.children[1].detailText, /String descriptor 2 \(language 0x0409\): Cam & Mic/);
  assert.match(hub.children[1].detailText, /PnP pnpDescription: Camera & microphone/);
  assert.match(hub.children[1].detailText, /Open pipe count: 3/);
  assert.match(hub.children[0].detailText, /Companion port 9 on USB#Companion/);
  assert.match(hub.children[1].detailText, /Configuration 0: value=1, interfaces=2/);
  assert.match(hub.children[1].detailText, /max power=50 units \(400 mA maximum; 8 mA\/unit\)/);
  assert.match(hub.children[1].detailText, /Interface: number=1, alternate=0, endpoints=1/);
  assert.match(hub.children[1].detailText, /IN Interrupt/);
});

test('maps an empty controller list to an empty tree', () => {
  assert.deepEqual(toTreeNodes([]), []);
});

test('displays USB4 PnP children below their host router without a synthetic hub', () => {
  const tree = toTreeNodes([{ type: 'controller', name: 'USB4 Host Router', children: [
    { type: 'pnpDevice', name: 'USB4 Root Device Router', pnpProperties: { powerState: 'D0' }, children: [] },
  ] }]);
  assert.equal(tree[0].label, 'USB4 Host Router');
  assert.deepEqual(tree[0].children.map((child) => child.label), ['USB4 Root Device Router']);
  assert.match(tree[0].children[0].detailText, /PnP powerState: D0/);
});

test('lists each device interface path separately in details', () => {
  const text = nodeDetail({ type: 'pnpDevice', pnpProperties: {
    deviceInterfacePaths: '\\\\?\\USB#ONE | \\\\?\\USB#TWO',
  } });
  assert.ok(text.includes('PnP deviceInterfacePath 1: \\\\?\\USB#ONE'));
  assert.ok(text.includes('PnP deviceInterfacePath 2: \\\\?\\USB#TWO'));
});

test('retains Windows container, power, and child identity details on a physical port', () => {
  const controllers = structuredClone(fixture.controllers);
  controllers[0].children[0].ports[1].children[0].pnpProperties = {
    containerId: '{01234567-89ab-cdef-0123-456789abcdef}',
    powerState: 'D0',
    childInstanceIds: 'USB\\VID_1234&PID_ABCD\\child',
  };
  const port = toTreeNodes(controllers)[0].children[0].children[1];
  assert.match(port.detailText, /PnP containerId: \{01234567-89ab-cdef-0123-456789abcdef\}/);
  assert.match(port.detailText, /PnP powerState: D0/);
  assert.match(port.detailText, /PnP childInstanceIds: USB\\VID_1234/);
});

test('filters by device details and retains matching ancestors', () => {
  const tree = toTreeNodes(fixture.controllers);
  const filtered = filterTreeNodes(tree, 'abcd');

  assert.equal(filtered.length, 1);
  assert.match(filtered[0].children[0].children[0].detailText, /Product ID: 0xabcd/);
  assert.equal(tree[0].children[0].children.length, 2);
});

test('filters case-insensitively by the visible node label', () => {
  const tree = toTreeNodes(fixture.controllers);

  assert.equal(filterTreeNodes(tree, 'root hub')[0].children[0].label, 'Root Hub');
});

test('returns the complete tree for an empty query and no nodes for a miss', () => {
  const tree = toTreeNodes(fixture.controllers);

  assert.deepEqual(filterTreeNodes(tree, '  '), tree);
  assert.deepEqual(filterTreeNodes(tree, 'not-a-device'), []);
});

test('shows USB serial ports under their device, including multiple ports and search', () => {
  const device = fixture.controllers[0].children[0].ports[1].children[0];
  const controllers = structuredClone(fixture.controllers);
  controllers[0].children[0].ports[1].children[0].serialPorts = [
    { portName: 'COM41', friendlyName: 'Example Serial Adapter (COM41)', instanceId: 'USB\\VID_CAFE&PID_0001\\0', serviceName: 'usbser' },
    { portName: 'COM42', friendlyName: 'Example Serial Adapter (COM42)', instanceId: 'USB\\VID_CAFE&PID_0001\\2', serviceName: 'usbser' },
  ];
  const tree = toTreeNodes(controllers);
  const usbDevice = tree[0].children[0].children[1];
  assert.match(usbDevice.label, /COM41, COM42/);
  assert.match(usbDevice.detailText, /Serial port: COM41.*Example Serial Adapter/);
  assert.equal(usbDevice.children.length, 2);
  assert.match(usbDevice.children[0].label, /^COM41: Example Serial Adapter/);
  assert.match(usbDevice.children[0].detailText, /USB\\VID_CAFE/);
  const matchingDevice = filterTreeNodes(tree, 'COM42')[0].children[0].children[0];
  assert.deepEqual(matchingDevice.children.map((child) => child.portName), ['COM42']);
  assert.equal(toTreeNodes(fixture.controllers)[0].children[0].children[1].children.length, 0);
  assert.equal(device.serialPorts, undefined);
});

test('uses a Windows COM friendly name for the physical port label without repeating COM', () => {
  const controllers = structuredClone(fixture.controllers);
  const device = controllers[0].children[0].ports[1].children[0];
  device.pnpProperties.friendlyName = 'Example Serial Adapter (COM41)';
  device.pnpProperties.instanceId = 'USB\\VID_CAFE&PID_0001\\0';
  device.serialPorts = [{ portName: 'COM41', friendlyName: 'Example Serial Adapter (COM41)',
    instanceId: 'usb\\vid_cafe&pid_0001\\0' }];
  const port = toTreeNodes(controllers)[0].children[0].children[1];
  assert.equal(port.label, 'Port 2: Example Serial Adapter (COM41)');
  assert.equal(port.children.length, 0);
  assert.match(port.detailText, /Serial port: COM41/);
  assert.deepEqual(port.detailSections.map((section) => section.title), ['Physical Port', 'USB Device']);
});

test('keeps a descendant Bluetooth COM port as its own child node', () => {
  const controllers = structuredClone(fixture.controllers);
  const device = controllers[0].children[0].ports[1].children[0];
  device.pnpProperties.instanceId = 'USB\\VID_BEEF&PID_1001\\adapter';
  device.serialPorts = [{ portName: 'COM43', friendlyName: 'Bluetooth serial (COM43)',
    instanceId: 'BTHENUM\\service\\device' }];
  const usbDevice = toTreeNodes(controllers)[0].children[0].children[1];
  assert.equal(usbDevice.children.length, 1);
  assert.equal(usbDevice.children[0].portName, 'COM43');
});

test('shows PnP descendants and does not duplicate a COM port already in that subtree', () => {
  const controllers = structuredClone(fixture.controllers);
  const device = controllers[0].children[0].ports[1].children[0];
  device.serialPorts = [{ portName: 'COM43', friendlyName: 'Bluetooth serial (COM43)',
    instanceId: 'BTHENUM\\service\\device' }];
  device.children = [{ type: 'pnpDevice', name: 'Bluetooth RFCOMM', instanceId: 'BTHENUM\\service',
    children: [{ type: 'pnpDevice', name: 'Bluetooth serial (COM43)', portName: 'COM43',
      instanceId: 'BTHENUM\\service\\device', children: [] }] }];
  const port = toTreeNodes(controllers)[0].children[0].children[1];
  assert.equal(port.children.length, 1);
  assert.equal(port.children[0].children.length, 1);
  assert.match(port.children[0].children[0].label, /COM43/);
  assert.equal(port.children[0].children[0].portName, 'COM43');
});

test('presents connected device and downstream hub on their physical port row', () => {
  const controllers = structuredClone(fixture.controllers);
  const device = controllers[0].children[0].ports[1].children[0];
  device.pnpProperties.friendlyName = 'Example Serial Adapter (COM41)';
  device.serialPorts = [{ portName: 'COM41', instanceId: 'USB\\VID_CAFE\\0' }];
  device.pnpProperties.instanceId = 'USB\\VID_CAFE\\0';
  const port = toTreeNodes(controllers)[0].children[0].children[1];
  assert.equal(port.label, 'Port 2: Example Serial Adapter (COM41)');
  assert.equal(port.children.length, 0);
  assert.match(port.detailText, /Vendor ID: 0x1234/);
  assert.match(port.detailText, /Serial port: COM41/);

  device.deviceIsHub = true;
  device.children = [{ type: 'hub', name: 'Downstream Hub', ports: [
    { type: 'port', port: 1, status: 'disconnected', children: [] },
  ] }];
  const hubPort = toTreeNodes(controllers)[0].children[0].children[1];
  assert.equal(hubPort.children.length, 1);
  assert.equal(hubPort.children[0].label, 'Port 1: disconnected');
  assert.match(hubPort.detailText, /Hub port count|Downstream Hub/);
  assert.deepEqual(hubPort.detailSections.map((section) => section.title),
    ['Physical Port', 'USB Device', 'Downstream Hub: Downstream Hub']);
});

test('uses the PnP description when USB string descriptors have no product name', () => {
  const controllers = structuredClone(fixture.controllers);
  const device = controllers[0].children[0].ports[1].children[0];
  device.product = '';
  device.manufacturer = '';
  device.pnpProperties.pnpDescription = 'Example Bluetooth Adapter';
  const port = toTreeNodes(controllers)[0].children[0].children[1];
  assert.match(port.label, /Example Bluetooth Adapter/);
});

test('shows setup, status, and driver registry details on the physical port', () => {
  const controllers = structuredClone(fixture.controllers);
  const device = controllers[0].children[0].ports[1].children[0];
  Object.assign(device.pnpProperties, {
    setupClass: 'Ports', classGuid: '{4d36e978-e325-11ce-bfc1-08002be10318}',
    devNodeStatus: '0x180200a', problemCode: '0',
    driverInf: 'oem42.inf', driverVersion: '10.0.1',
  });
  const port = toTreeNodes(controllers)[0].children[0].children[1];
  for (const field of ['PnP setupClass: Ports', 'PnP classGuid:',
    'PnP devNodeStatus: 0x180200a', 'PnP problemCode: 0',
    'PnP driverInf: oem42.inf', 'PnP driverVersion: 10.0.1']) {
    assert.ok(port.detailText.includes(field), field);
  }
});

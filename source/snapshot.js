const fs = require('node:fs/promises');
const { decodeBosDescriptor } = require('./descriptors');

function escapeXml(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '\uFFFD')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function snapshotNode(node, depth = 0) {
  const indent = '  '.repeat(depth);
  const fields = [
    ['type', node.type], ['name', node.name], ['symbolicLink', node.symbolicLink],
    ['port', node.port], ['status', node.status], ['connectionStatusCode', node.connectionStatusCode],
    ['error', node.error || node.hubError], ['vendorId', node.vendorId],
    ['productId', node.productId], ['deviceClass', node.deviceClass],
    ['deviceSubClass', node.deviceSubClass], ['deviceProtocol', node.deviceProtocol],
    ['speed', node.speed], ['usbVersion', node.usbVersion],
    ['deviceVersion', node.deviceVersion], ['maxPacketSize0', node.maxPacketSize0],
    ['configurationCount', node.configurationCount], ['manufacturer', node.manufacturer],
    ['deviceAddress', node.deviceAddress], ['openPipeCount', node.openPipeCount],
    ['currentConfigurationValue', node.currentConfigurationValue], ['deviceIsHub', node.deviceIsHub],
    ['product', node.product], ['serialNumber', node.serialNumber],
    ['deviceDescriptorHex', node.deviceDescriptorHex], ['bosDescriptorHex', node.bosDescriptorHex],
    ['portCount', node.portCount], ['hubCharacteristics', node.hubCharacteristics],
    ['powerOnToPowerGood', node.powerOnToPowerGood], ['hubControlCurrent', node.hubControlCurrent],
    ['supportedUsbProtocols', node.supportedUsbProtocols],
    ['superSpeedOperating', node.superSpeedOperating], ['superSpeedCapable', node.superSpeedCapable],
    ['superSpeedPlusOperating', node.superSpeedPlusOperating],
    ['superSpeedPlusCapable', node.superSpeedPlusCapable],
    ['portIsUserConnectable', node.portIsUserConnectable],
    ['portIsDebugCapable', node.portIsDebugCapable],
    ['portHasMultipleCompanions', node.portHasMultipleCompanions],
    ['portConnectorIsTypeC', node.portConnectorIsTypeC],
    ['companionPortNumber', node.companionPortNumber], ['companionHub', node.companionHub],
    ['driverKeyName', node.driverKeyName],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  const attributes = fields.map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
  const configurations = (node.configurationDescriptors || []).map((config) => {
    const configAttributes = Object.entries(config)
      .filter(([key, value]) => key !== 'descriptors' && value !== undefined && value !== null)
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
    const descriptors = (config.descriptors || []).map((descriptor) => {
      const descriptorAttributes = Object.entries(descriptor)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
      return `${indent}    <Descriptor${descriptorAttributes} />`;
    });
    if (!descriptors.length) return `${indent}  <Configuration${configAttributes} />`;
    return `${indent}  <Configuration${configAttributes}>\n${descriptors.join('\n')}\n${indent}  </Configuration>`;
  });
  const strings = (node.stringDescriptors || []).map((descriptor) => {
    const stringAttributes = Object.entries(descriptor)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
    return `${indent}  <StringDescriptor${stringAttributes} />`;
  });
  const pnpAttributes = Object.entries(node.pnpProperties || {})
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
  const pnp = Object.keys(node.pnpProperties || {}).length
    ? [`${indent}  <PnpProperties${pnpAttributes} />`] : [];
  const serialPorts = (node.serialPorts || []).map((port) => {
    const attributes = ['portName', 'friendlyName', 'instanceId', 'serviceName']
      .filter((key) => port[key] !== undefined && port[key] !== null && port[key] !== '')
      .map((key) => ` ${key}="${escapeXml(port[key])}"`).join('');
    return `${indent}  <SerialPort${attributes} />`;
  });
  const bosCapabilities = decodeBosDescriptor(node.bosDescriptorHex).map((capability) => {
    const capabilityAttributes = Object.entries(capability)
      .filter(([, value]) => value !== undefined && value !== null && !Array.isArray(value))
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
    const speeds = Array.isArray(capability.supportedSpeeds)
      ? capability.supportedSpeeds.map((speed) => `${indent}    <SupportedSpeed name="${escapeXml(speed)}" />`)
      : [];
    if (!speeds.length) return `${indent}  <BOSCapability${capabilityAttributes} />`;
    return `${indent}  <BOSCapability${capabilityAttributes}>\n${speeds.join('\n')}\n${indent}  </BOSCapability>`;
  });
  const companions = (node.companions || []).map((companion) => {
    const companionAttributes = Object.entries(companion)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`).join('');
    return `${indent}  <Companion${companionAttributes} />`;
  });
  const children = [
    ...(Array.isArray(node.ports) ? node.ports : []),
    ...(Array.isArray(node.children) ? node.children : []),
  ];
  if (!children.length && !configurations.length && !strings.length && !pnp.length && !serialPorts.length && !companions.length && !bosCapabilities.length) return `${indent}<Node${attributes} />`;
  return `${indent}<Node${attributes}>\n${[...configurations, ...strings, ...pnp, ...serialPorts, ...companions, ...bosCapabilities, ...children.map((child) => snapshotNode(child, depth + 1))].join('\n')}\n${indent}</Node>`;
}

function createSnapshot(topology, { generatedAt = new Date().toISOString() } = {}) {
  const controllers = topology.controllers.map((controller) => snapshotNode(controller, 1)).join('\n');
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<UsbDeviceTreeSnapshot version="1" generatedAt="${escapeXml(generatedAt)}">\n${controllers}\n</UsbDeviceTreeSnapshot>\n`, 'utf8');
}

async function exportSnapshot(vscode, xmlBuffer, { writeFile = fs.writeFile } = {}) {
  const destination = await vscode.window.showSaveDialog({
    filters: { 'XML reports': ['xml'] },
    saveLabel: 'Export XML Snapshot',
    title: 'Export USB XML Snapshot',
  });
  if (!destination) return false;

  await writeFile(destination.fsPath, xmlBuffer);
  return true;
}

module.exports = { createSnapshot, escapeXml, exportSnapshot };

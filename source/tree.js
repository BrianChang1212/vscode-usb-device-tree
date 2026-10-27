const { decodeBosDescriptor, decodeExtraDescriptor } = require('./descriptors');
const { englishT } = require('./l10n');

// Labels are display text (translated through t); detail lines and section titles stay English because
// detail.js parses them and translates at render time.

function deviceLabel(node, t = englishT) {
  if (node._displayLabel) return node._displayLabel;
  if (node.type === 'controller') {
    return node.pnpProperties?.friendlyName || node.pnpProperties?.pnpDescription
      || node.name || t('USB Host Controller');
  }
  if (node.type === 'hub') return node.name || t('USB Hub');
  if (node.type === 'port') {
    const attached = (node.children || []).find((child) => child.type === 'device');
    const friendly = attached?.pnpProperties?.friendlyName;
    // Port status codes come from Windows in English; show them translated, keep other codes as-is.
    const status = node.status === 'connected' ? t('connected')
      : node.status === 'disconnected' ? t('disconnected') : node.status;
    return t('Port {0}: {1}', node.port, friendly || status || 'unknown');
  }
  if (node.type === 'serialPort') return `${node.portName}: ${node.friendlyName || t('Serial port')}`;
  if (node.type === 'pnpDevice' && node.portName) {
    const name = node.name || node.pnpProperties?.friendlyName || t('Serial port');
    return name.includes(`(${node.portName})`) ? name : `${node.portName}: ${name}`;
  }
  if (node.type === 'device') {
    const vendor = Number.isInteger(node.vendorId) ? node.vendorId.toString(16).padStart(4, '0') : '????';
    const product = Number.isInteger(node.productId) ? node.productId.toString(16).padStart(4, '0') : '????';
    const friendly = node.pnpProperties?.friendlyName;
    const productName = friendly || node.product || node.pnpProperties?.pnpDescription || node.name || t('USB device');
    const maker = !friendly && node.product && node.manufacturer ? `${node.manufacturer} ` : '';
    const ports = (node.serialPorts || []).map((item) => item.portName).filter(Boolean);
    const missingPorts = ports.filter((port) => !productName.includes(`(${port})`));
    return `${maker}${productName} (VID_${vendor}&PID_${product})${missingPorts.length ? ` [${missingPorts.join(', ')}]` : ''}`;
  }
  return node.name || `USB ${node.type || 'node'}`;
}

function nodeChildren(node) {
  if (node._displayChildren) return node._displayChildren;
  const descendantIds = new Set();
  function collectIds(children) {
    for (const child of children || []) {
      if (child.instanceId) descendantIds.add(child.instanceId.toLocaleLowerCase());
      collectIds(child.children);
    }
  }
  if (Array.isArray(node.serialPorts)) collectIds(node.children);
  return [
    ...(Array.isArray(node.ports) ? node.ports : []),
    ...(Array.isArray(node.children) ? node.children : []),
    ...(Array.isArray(node.serialPorts) ? node.serialPorts
      .filter((port) => !port.instanceId ||
        (port.instanceId.toLocaleLowerCase() !== node.pnpProperties?.instanceId?.toLocaleLowerCase() &&
          !descendantIds.has(port.instanceId.toLocaleLowerCase())))
      .map((port) => ({ type: 'serialPort', ...port })) : []),
  ];
}

function displayNode(node, t = englishT) {
  if (node.type !== 'port' || !Array.isArray(node.children) || node.children.length !== 1 ||
      node.children[0].type !== 'device') return node;
  const device = node.children[0];
  const hub = (device.children || []).find((child) => child.type === 'hub');
  const childNodes = nodeChildren(device).filter((child) => child !== hub);
  if (hub) childNodes.push(...nodeChildren(hub));
  const friendly = device.pnpProperties?.friendlyName;
  const name = friendly || deviceLabel(device, t);
  const missingPorts = (friendly ? device.serialPorts || [] : []).map((port) => port.portName)
    .filter((port) => port && !name.includes(`(${port})`));
  const visibleName = `${name}${missingPorts.length ? ` [${missingPorts.join(', ')}]` : ''}`;
  return {
    ...node, ...device,
    type: 'port', port: node.port, status: node.status,
    error: node.error || device.error,
    _displayLabel: t('Port {0}: {1}', node.port, visibleName),
    _displayDetail: [nodeDetail(node), `USB device: ${name}`, nodeDetail(device),
      hub ? `Hub: ${hub.name || 'USB Hub'}\n${nodeDetail(hub)}` : ''].filter(Boolean).join('\n\n'),
    _detailSections: [
      { title: 'Physical Port', text: nodeDetail(node) },
      { title: 'USB Device', text: nodeDetail(device) },
      ...(hub ? [{ title: `Downstream Hub: ${hub.name || 'USB Hub'}`, text: nodeDetail(hub) }] : []),
    ],
    _displayChildren: childNodes,
  };
}

function nodeDetail(node) {
  const classNames = {
    0x00: 'Defined per interface', 0x01: 'Audio', 0x02: 'Communications',
    0x03: 'Human Interface Device', 0x05: 'Physical', 0x06: 'Image',
    0x07: 'Printer', 0x08: 'Mass Storage', 0x09: 'Hub', 0x0a: 'CDC Data',
    0x0b: 'Smart Card', 0x0d: 'Content Security', 0x0e: 'Video',
    0x0f: 'Personal Healthcare', 0x10: 'Audio/Video', 0x11: 'Billboard',
    0xdc: 'Diagnostic', 0xe0: 'Wireless Controller', 0xef: 'Miscellaneous',
    0xfe: 'Application Specific', 0xff: 'Vendor Specific',
  };
  const fields = [
    ['Type', node.type], ['Status', node.status], ['Port', node.port],
    ['COM port', node.portName], ['Friendly name', node.friendlyName],
    ['PnP instance ID', node.instanceId], ['Driver service', node.serviceName],
    ['Connection status code', node.connectionStatusCode], ['Hub symbolic link', node.symbolicLink],
    ['Vendor ID', Number.isInteger(node.vendorId) ? `0x${node.vendorId.toString(16).padStart(4, '0')}` : undefined],
    ['Product ID', Number.isInteger(node.productId) ? `0x${node.productId.toString(16).padStart(4, '0')}` : undefined],
    ['Class', Number.isInteger(node.deviceClass)
      ? `0x${node.deviceClass.toString(16).padStart(2, '0')} ${classNames[node.deviceClass] || 'Class-specific'}` : node.deviceClass],
    ['Subclass', node.deviceSubClass], ['Protocol', node.deviceProtocol], ['Speed', node.speed],
    ['USB version', formatBcd(node.usbVersion)], ['Device version', formatBcd(node.deviceVersion)],
    ['Endpoint 0 max packet size', node.maxPacketSize0],
    ['Configuration count', node.configurationCount],
    ['Device address', node.deviceAddress], ['Open pipe count', node.openPipeCount],
    ['Current configuration value', node.currentConfigurationValue], ['Is hub', node.deviceIsHub],
    ['Manufacturer', node.manufacturer], ['Product', node.product],
    ['Serial number', node.serialNumber], ['Hub port count', node.portCount],
    ['Hub characteristics', node.hubCharacteristics],
    ['Hub power-on delay (2 ms units)', node.powerOnToPowerGood],
    ['Hub control current (mA)', node.hubControlCurrent],
    ['Supported USB protocol bits', node.supportedUsbProtocols],
    ['SuperSpeed operating', node.superSpeedOperating], ['SuperSpeed capable', node.superSpeedCapable],
    ['SuperSpeedPlus operating', node.superSpeedPlusOperating],
    ['SuperSpeedPlus capable', node.superSpeedPlusCapable],
    ['User connectable', node.portIsUserConnectable], ['Debug capable', node.portIsDebugCapable],
    ['Multiple companion ports', node.portHasMultipleCompanions],
    ['Type-C connector', node.portConnectorIsTypeC],
    ['Companion port number', node.companionPortNumber], ['Companion hub', node.companionHub],
    ['Driver key', node.driverKeyName],
    ['Error', node.error || node.hubError],
  ];
  const lines = fields.filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${value}`);
  for (const config of node.configurationDescriptors || []) {
    const powerUnitMilliAmps = node.usbVersion >= 0x0300 ? 8 : 2;
    const maxPower = Number.isInteger(config.maxPower)
      ? `${config.maxPower} units (${config.maxPower * powerUnitMilliAmps} mA maximum; ${powerUnitMilliAmps} mA/unit)`
      : 'unavailable';
    lines.push(`Configuration ${config.index}: value=${config.value}, interfaces=${config.interfaceCount}, attributes=0x${Number(config.attributes).toString(16).padStart(2, '0')}, max power=${maxPower}, string index=${config.stringIndex}`);
    for (const descriptor of config.descriptors || []) {
      const decoded = decodeExtraDescriptor(descriptor);
      const kind = descriptor.type === 4 ? 'Interface' : descriptor.type === 5 ? 'Endpoint' : decoded.name;
      const details = descriptor.type === 4
        ? `number=${descriptor.interfaceNumber}, alternate=${descriptor.alternateSetting}, endpoints=${descriptor.endpointCount}, class=0x${Number(descriptor.class).toString(16).padStart(2, '0')}, subclass=0x${Number(descriptor.subclass).toString(16).padStart(2, '0')}, protocol=0x${Number(descriptor.protocol).toString(16).padStart(2, '0')}`
        : descriptor.type === 5
          ? `address=0x${Number(descriptor.endpointAddress).toString(16).padStart(2, '0')}, ${descriptor.direction} ${descriptor.transferType}, attributes=0x${Number(descriptor.attributes).toString(16).padStart(2, '0')}, maxPacket=${descriptor.maxPacketSize}, interval=${descriptor.interval}`
          : descriptor.type === 0x30
            ? `maxBurst=${decoded.maxBurst ?? 'unavailable'}, attributes=${decoded.attributes || 'unavailable'}, bytesPerInterval=${decoded.bytesPerInterval ?? 'unavailable'}`
            : descriptor.type === 0x21 && decoded.hidVersion
              ? `HID=${decoded.hidVersion}, country=${decoded.countryCode}, subordinate=${decoded.subordinateDescriptors.map((item) => `type=0x${item.type.toString(16).padStart(2, '0')} length=${item.length}`).join('; ')}`
            : descriptor.subtype !== undefined ? `subtype=0x${Number(descriptor.subtype).toString(16).padStart(2, '0')}` : '';
      lines.push(`  ${kind}${details ? `: ${details}` : ''}; raw=${descriptor.rawHex}`);
    }
    lines.push(`  Configuration descriptor bytes: ${config.descriptorHex || 'unavailable'}`);
  }
  for (const descriptor of node.stringDescriptors || []) {
    lines.push(`String descriptor ${descriptor.index} (language 0x${Number(descriptor.languageId).toString(16).padStart(4, '0')}): ${descriptor.value}`);
  }
  for (const [key, value] of Object.entries(node.pnpProperties || {})) {
    if (key === 'deviceInterfacePaths') {
      value.split(' | ').forEach((path, index) => {
        lines.push(`PnP deviceInterfacePath ${index + 1}: ${path}`);
      });
      continue;
    }
    lines.push(`PnP ${key}: ${value}`);
  }
  for (const port of node.serialPorts || []) {
    lines.push(`Serial port: ${port.portName}${port.friendlyName ? ` (${port.friendlyName})` : ''}`);
    if (port.instanceId) lines.push(`  PnP instance ID: ${port.instanceId}`);
    if (port.serviceName) lines.push(`  Driver service: ${port.serviceName}`);
  }
  for (const companion of node.companions || []) {
    lines.push(`Companion port ${companion.portNumber} on ${companion.hub}`);
  }
  if (node.deviceDescriptorHex) lines.push(`Device descriptor bytes: ${node.deviceDescriptorHex}`);
  if (node.bosDescriptorHex) lines.push(`BOS descriptor bytes: ${node.bosDescriptorHex}`);
  for (const capability of decodeBosDescriptor(node.bosDescriptorHex)) {
    const details = Object.entries(capability)
      .filter(([key]) => !['name', 'rawHex'].includes(key))
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(', ') : value}`)
      .join(', ');
    lines.push(`BOS capability: ${capability.name}${details ? ` (${details})` : ''}`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (/Hex$/.test(key) && value && !['deviceDescriptorHex', 'bosDescriptorHex'].includes(key)) lines.push(`${key}: ${value}`);
  }
  return lines.join('\n');
}

function formatBcd(value) {
  if (!Number.isInteger(value)) return value;
  const hex = value.toString(16).padStart(4, '0');
  return `${Number(hex.slice(0, 2))}.${hex.slice(2)} (0x${hex})`;
}

function toTreeNodes(nodes, parentId = '', t = englishT) {
  return nodes.map((input, index) => {
    const node = displayNode(input, t);
    const id = parentId ? `${parentId}.${index}` : String(index);
    const children = nodeChildren(node);
    return {
      id,
      parentId: parentId || undefined,
      type: node.type,
      name: node.name,
      port: node.port,
      status: node.status,
      connectionStatusCode: node.connectionStatusCode,
      symbolicLink: node.symbolicLink,
      error: node.error || node.hubError,
      vendorId: node.vendorId,
      productId: node.productId,
      deviceClass: node.deviceClass,
      deviceSubClass: node.deviceSubClass,
      deviceProtocol: node.deviceProtocol,
      speed: node.speed,
      usbVersion: node.usbVersion,
      deviceVersion: node.deviceVersion,
      maxPacketSize0: node.maxPacketSize0,
      configurationCount: node.configurationCount,
      deviceAddress: node.deviceAddress,
      openPipeCount: node.openPipeCount,
      currentConfigurationValue: node.currentConfigurationValue,
      deviceIsHub: node.deviceIsHub,
      manufacturer: node.manufacturer,
      product: node.product,
      serialNumber: node.serialNumber,
      deviceDescriptorHex: node.deviceDescriptorHex,
      configurationDescriptors: node.configurationDescriptors,
      stringDescriptors: node.stringDescriptors,
      driverKeyName: node.driverKeyName,
      pnpProperties: node.pnpProperties,
      serialPorts: node.serialPorts,
      portName: node.portName,
      friendlyName: node.friendlyName,
      instanceId: node.instanceId,
      serviceName: node.serviceName,
      bosDescriptorHex: node.bosDescriptorHex,
      portCount: node.portCount,
      hubCharacteristics: node.hubCharacteristics,
      powerOnToPowerGood: node.powerOnToPowerGood,
      hubControlCurrent: node.hubControlCurrent,
      supportedUsbProtocols: node.supportedUsbProtocols,
      superSpeedOperating: node.superSpeedOperating,
      superSpeedCapable: node.superSpeedCapable,
      superSpeedPlusOperating: node.superSpeedPlusOperating,
      superSpeedPlusCapable: node.superSpeedPlusCapable,
      portIsUserConnectable: node.portIsUserConnectable,
      portIsDebugCapable: node.portIsDebugCapable,
      portHasMultipleCompanions: node.portHasMultipleCompanions,
      portConnectorIsTypeC: node.portConnectorIsTypeC,
      companionPortNumber: node.companionPortNumber,
      companionHub: node.companionHub,
      companions: node.companions,
      label: deviceLabel(node, t),
      detailText: node._displayDetail || nodeDetail(node),
      detailSections: node._detailSections || [{
        title: node.type === 'controller' ? 'Host Controller' : node.type === 'hub' ? 'Hub'
          : node.type === 'port' ? 'Physical Port' : node.type === 'serialPort' ? 'COM Port' : 'USB Device',
        text: nodeDetail(node),
      }],
      children: toTreeNodes(children, id, t),
    };
  });
}

function filterTreeNodes(nodes, query) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  if (!normalizedQuery) return nodes;

  const filtered = [];
  for (const node of nodes) {
    const children = filterTreeNodes(node.children, normalizedQuery);
    const matches = `${node.label}\n${node.detailText}`.toLocaleLowerCase().includes(normalizedQuery);
    if (matches || children.length > 0) {
      filtered.push({ ...node, children });
    }
  }
  return filtered;
}

module.exports = { filterTreeNodes, nodeChildren, nodeDetail, toTreeNodes };

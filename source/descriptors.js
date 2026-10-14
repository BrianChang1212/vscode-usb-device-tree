const BOS_CAPABILITIES = new Map([
  [0x02, 'USB 2.0 Extension'],
  [0x03, 'SuperSpeed USB Device Capability'],
  [0x04, 'Container ID'],
  [0x05, 'Platform Capability'],
  [0x0a, 'SuperSpeedPlus USB Device Capability'],
  [0x0b, 'Precision Time Measurement Capability'],
  [0x0c, 'Wireless USB Device Capability'],
]);

const AUDIO_INTERFACE_SUBTYPES = new Map([
  [0x01, 'Header'], [0x02, 'Input Terminal'], [0x03, 'Output Terminal'],
  [0x04, 'Mixer Unit'], [0x05, 'Selector Unit'], [0x06, 'Feature Unit'],
  [0x07, 'Processing Unit'], [0x08, 'Extension Unit'],
]);

const AUDIO_STREAMING_SUBTYPES = new Map([[0x01, 'Audio Streaming General'], [0x02, 'Format Type']]);

const VIDEO_CONTROL_SUBTYPES = new Map([
  [0x01, 'Video Control Header'], [0x02, 'Input Terminal'], [0x03, 'Output Terminal'],
  [0x04, 'Selector Unit'], [0x05, 'Processing Unit'], [0x06, 'Extension Unit'],
  [0x07, 'Encoding Unit'],
]);

const VIDEO_STREAMING_SUBTYPES = new Map([
  [0x01, 'Video Streaming Input Header'], [0x02, 'Video Streaming Output Header'],
  [0x03, 'Still Image Frame'], [0x04, 'Uncompressed Format'],
  [0x05, 'Uncompressed Frame'], [0x06, 'MJPEG Format'],
  [0x07, 'MJPEG Frame'], [0x0d, 'Color Matching'],
]);

function bytesFromHex(value) {
  if (typeof value !== 'string' || value.length % 2 || !/^[0-9a-f]*$/i.test(value)) return [];
  const bytes = [];
  for (let offset = 0; offset < value.length; offset += 2) {
    bytes.push(Number.parseInt(value.slice(offset, offset + 2), 16));
  }
  return bytes;
}

function littleEndian(bytes, offset, length) {
  let value = 0;
  for (let index = 0; index < length; index += 1) value += bytes[offset + index] * (256 ** index);
  return value;
}

function normalizedHex(bytes) {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function decodeBosCapability(bytes) {
  const subtype = bytes[2];
  const result = {
    name: BOS_CAPABILITIES.get(subtype) || 'Unknown Device Capability',
    rawHex: normalizedHex(bytes),
  };
  if (subtype === 0x02 && bytes.length >= 7) {
    const attributes = littleEndian(bytes, 3, 4);
    return { ...result, lpmSupported: Boolean(attributes & 0x02), attributes: `0x${attributes.toString(16).padStart(8, '0')}` };
  }
  if (subtype === 0x03 && bytes.length >= 10) {
    const speedBits = littleEndian(bytes, 4, 2);
    const speeds = [[0, 'Low-Speed'], [1, 'Full-Speed'], [2, 'High-Speed'], [3, 'SuperSpeed']];
    return {
      ...result,
      attributes: `0x${bytes[3].toString(16).padStart(2, '0')}`,
      supportedSpeeds: speeds.filter(([bit]) => speedBits & (1 << bit)).map(([, name]) => name),
      functionalitySupport: bytes[6],
      u1ExitLatency: bytes[7],
      u2ExitLatency: littleEndian(bytes, 8, 2),
    };
  }
  if (subtype === 0x04 && bytes.length >= 20) {
    return { ...result, containerId: result.rawHex.slice(8, 40) };
  }
  return result;
}

function decodeBosDescriptor(value) {
  const bytes = bytesFromHex(value);
  if (bytes.length < 5 || bytes[1] !== 0x0f || bytes[0] < 5) return [];
  const totalLength = Math.min(bytes.length, littleEndian(bytes, 2, 2));
  const capabilities = [];
  for (let offset = bytes[0]; offset + 2 <= totalLength;) {
    const length = bytes[offset];
    if (length < 3 || offset + length > totalLength) {
      if (offset + 2 < totalLength && bytes[offset + 1] === 0x10) {
        capabilities.push(decodeBosCapability(bytes.slice(offset, totalLength)));
      }
      break;
    }
    if (bytes[offset + 1] === 0x10) capabilities.push(decodeBosCapability(bytes.slice(offset, offset + length)));
    offset += length;
  }
  return capabilities;
}

function decodeExtraDescriptor(descriptor) {
  const bytes = bytesFromHex(descriptor.rawHex);
  const rawHex = normalizedHex(bytes);
  if (descriptor.type === 0x30) {
    const decoded = { name: 'SuperSpeed Endpoint Companion', rawHex };
    if (bytes.length >= 6) {
      decoded.maxBurst = bytes[2];
      decoded.attributes = `0x${bytes[3].toString(16).padStart(2, '0')}`;
      decoded.bytesPerInterval = littleEndian(bytes, 4, 2);
    }
    return decoded;
  }
  if (descriptor.type === 0x21 && descriptor.interfaceClass === 0x03) {
    const subordinateDescriptors = [];
    if (bytes.length >= 6) {
      const count = bytes[5];
      for (let index = 0, offset = 6; index < count && offset + 3 <= bytes.length; index += 1, offset += 3) {
        subordinateDescriptors.push({ type: bytes[offset], length: littleEndian(bytes, offset + 1, 2) });
      }
    }
    const version = littleEndian(bytes, 2, 2).toString(16).padStart(4, '0');
    return {
      name: 'HID Descriptor',
      hidVersion: `${Number(version.slice(0, 2))}.${version.slice(2)}`,
      countryCode: bytes[4],
      subordinateDescriptors,
      rawHex,
    };
  }
  if ((descriptor.type === 0x24 || descriptor.type === 0x25) && bytes.length >= 3) {
    let group = 'Class-Specific';
    let subtypeNames;
    if (descriptor.interfaceClass === 0x01) {
      group = 'Audio';
      subtypeNames = descriptor.interfaceSubClass === 0x02
        ? AUDIO_STREAMING_SUBTYPES : AUDIO_INTERFACE_SUBTYPES;
    } else if (descriptor.interfaceClass === 0x0e) {
      group = 'Video';
      subtypeNames = descriptor.interfaceSubClass === 0x02
        ? VIDEO_STREAMING_SUBTYPES : VIDEO_CONTROL_SUBTYPES;
    } else if (descriptor.interfaceClass === 0x03) {
      group = 'HID';
    }
    const subtype = descriptor.subtype ?? bytes[2];
    const subtypeName = subtypeNames?.get(subtype);
    const scope = descriptor.type === 0x25 ? 'Endpoint' : 'Interface';
    return {
      name: `${group} Class-Specific ${scope} Descriptor${subtypeName ? ` (${subtypeName})` : ''}`,
      subtype,
      rawHex,
    };
  }
  return { name: `Descriptor ${descriptor.type}`, rawHex };
}

module.exports = { decodeBosDescriptor, decodeExtraDescriptor };

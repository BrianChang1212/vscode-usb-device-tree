const assert = require('node:assert/strict');
const test = require('node:test');

const { decodeBosDescriptor, decodeExtraDescriptor } = require('../source/descriptors');

test('decodes BOS USB 2.0 extension and SuperSpeed capabilities while retaining raw bytes', () => {
  const capabilities = decodeBosDescriptor('050F160002071002020000000A1003000E0001010200');

  assert.equal(capabilities.length, 2);
  assert.deepEqual(capabilities[0], {
    name: 'USB 2.0 Extension', lpmSupported: true, attributes: '0x00000002',
    rawHex: '07100202000000',
  });
  assert.equal(capabilities[1].name, 'SuperSpeed USB Device Capability');
  assert.deepEqual(capabilities[1].supportedSpeeds, ['Full-Speed', 'High-Speed', 'SuperSpeed']);
  assert.equal(capabilities[1].u1ExitLatency, 1);
  assert.equal(capabilities[1].u2ExitLatency, 2);
});

test('decodes USB 3 endpoint companion and class-specific audio/video descriptor labels', () => {
  assert.deepEqual(decodeExtraDescriptor({ type: 48, rawHex: '063003084000' }), {
    name: 'SuperSpeed Endpoint Companion', maxBurst: 3,
    attributes: '0x08', bytesPerInterval: 64, rawHex: '063003084000',
  });
  assert.equal(decodeExtraDescriptor({
    type: 36, interfaceClass: 1, rawHex: '07240100000000',
  }).name, 'Audio Class-Specific Interface Descriptor (Header)');
  assert.equal(decodeExtraDescriptor({
    type: 36, interfaceClass: 14, interfaceSubClass: 1, rawHex: '062401000000',
  }).name, 'Video Class-Specific Interface Descriptor (Video Control Header)');
  assert.equal(decodeExtraDescriptor({
    type: 36, interfaceClass: 14, interfaceSubClass: 2, rawHex: '062401000000',
  }).name, 'Video Class-Specific Interface Descriptor (Video Streaming Input Header)');
  assert.deepEqual(decodeExtraDescriptor({
    type: 33, interfaceClass: 3, rawHex: '092111010001223F00',
  }), {
    name: 'HID Descriptor', hidVersion: '1.11', countryCode: 0,
    subordinateDescriptors: [{ type: 34, length: 63 }], rawHex: '092111010001223F00',
  });
});

test('returns unknown capability bytes without guessing and tolerates truncated data', () => {
  const capabilities = decodeBosDescriptor('050F0A0001051055');

  assert.equal(capabilities.length, 1);
  assert.equal(capabilities[0].name, 'Unknown Device Capability');
  assert.equal(capabilities[0].rawHex, '051055');
  assert.deepEqual(decodeBosDescriptor('050F'), []);
  assert.equal(decodeExtraDescriptor({ type: 48, rawHex: '063003' }).name,
    'SuperSpeed Endpoint Companion');
});

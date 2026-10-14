const assert = require('node:assert/strict');
const test = require('node:test');

const { execute, parseTopology, queryControllers } = require('../source/native');

const sample = {
  version: 1,
  controllers: [{
    type: 'controller', name: 'Controller', children: [{
      type: 'hub', name: 'Root Hub', ports: [
        { type: 'port', port: 1, status: 'disconnected', children: [] },
        { type: 'port', port: 2, status: 'connected', children: [{
          type: 'device', vendorId: 4660, productId: 22136, children: [],
        }] },
      ],
    }],
  }],
};

test('validates controller, hub, connected device, and empty physical port nodes', () => {
  const topology = parseTopology(JSON.stringify(sample));
  assert.equal(topology.controllers[0].children[0].ports.length, 2);
  assert.equal(topology.controllers[0].children[0].ports[0].status, 'disconnected');
  assert.equal(topology.controllers[0].children[0].ports[1].children[0].vendorId, 4660);
});

test('accepts a USB4 host router with PnP children without inventing USB ports', () => {
  const topology = parseTopology(JSON.stringify({ version: 1, controllers: [{
    type: 'controller', controllerIndex: 4, name: 'USB4 Host Router', children: [
      { type: 'pnpDevice', name: 'USB4 Root Device Router', children: [] },
      { type: 'pnpDevice', name: 'USB4 Virtual Power Coordination Device', children: [] },
    ],
  }] }));
  assert.equal(topology.controllers[0].children.length, 2);
  assert.equal(topology.controllers[0].children[0].ports, undefined);
});

test('rejects invalid JSON, unsupported schemas, and output above the configured limit', () => {
  assert.throws(() => parseTopology('{'), { code: 'MALFORMED_JSON' });
  assert.throws(() => parseTopology('{"version":2,"controllers":[]}'), { code: 'INVALID_TOPOLOGY' });
  assert.throws(() => parseTopology(' '.repeat(20), { maxBytes: 10 }), { code: 'OUTPUT_TOO_LARGE' });
});

test('rejects malformed nodes and excessive topology depth', () => {
  assert.throws(() => parseTopology('{"version":1,"controllers":[null]}'), { code: 'INVALID_TOPOLOGY' });
  let node = { type: 'controller', children: [] };
  const controller = node;
  for (let depth = 0; depth < 66; depth += 1) {
    const child = { type: 'hub', children: [] };
    node.children.push(child);
    node = child;
  }
  assert.throws(() => parseTopology(JSON.stringify({ version: 1, controllers: [controller] })), { code: 'TREE_TOO_DEEP' });
});

test('accepts attributed COM ports and rejects malformed serial port data', () => {
  const device = sample.controllers[0].children[0].ports[1].children[0];
  const topology = structuredClone(sample);
  topology.controllers[0].children[0].ports[1].children[0].serialPorts = [
    { portName: 'COM42', instanceId: 'USB\\VID_CAFE&PID_0001\\0', friendlyName: 'Example Serial Adapter' },
  ];
  assert.equal(parseTopology(JSON.stringify(topology)).controllers[0].children[0].ports[1].children[0].serialPorts[0].portName, 'COM42');
  topology.controllers[0].children[0].ports[1].children[0].serialPorts = [{ portName: 'LPT1' }];
  assert.throws(() => parseTopology(JSON.stringify(topology)), { code: 'INVALID_TOPOLOGY' });
  topology.controllers[0].children[0].ports[1].children[0].serialPorts = 'COM42';
  assert.throws(() => parseTopology(JSON.stringify(topology)), { code: 'INVALID_TOPOLOGY' });
  assert.equal(device.serialPorts, undefined);
});

test('runs the bundled helper with bounded output and maps a process timeout', async () => {
  await assert.rejects(execute('usb-topology.exe', {
    execFileImpl(executable, args, options, callback) {
      assert.equal(executable, 'usb-topology.exe');
      assert.deepEqual(args, ['--json']);
      assert.equal(options.maxBuffer, 8 * 1024 * 1024);
      const error = new Error('timed out');
      error.killed = true;
      callback(error);
    },
  }), { code: 'PROCESS_TIMEOUT' });
});

test('maps a successful native process response into the validated topology', async () => {
  const topology = await execute('usb-topology.exe', {
    execFileImpl(_executable, _args, _options, callback) {
      callback(null, Buffer.from(JSON.stringify(sample)));
    },
  });
  assert.equal(topology.controllers[0].children[0].ports[1].status, 'connected');
});

test('keeps healthy controllers when one controller query times out', async () => {
  const calls = [];
  const result = await queryControllers('usb-topology.exe', {
    execFileImpl(_executable, args, _options, callback) {
      calls.push(args.join(' '));
      if (args[0] === '--list') return callback(null, Buffer.from(JSON.stringify({
        version: 1, controllers: [
          { type: 'controller', name: 'Controller 1', controllerIndex: 0, children: [] },
          { type: 'controller', name: 'Controller 2', controllerIndex: 1, children: [] },
        ],
      })));
      if (args[1] === '0') return callback(Object.assign(new Error('timeout'), { killed: true }));
      return callback(null, Buffer.from(JSON.stringify({ version: 1,
        controllers: [{ ...sample.controllers[0], controllerIndex: 1 }] })));
    },
  });
  assert.deepEqual(calls.sort(), ['--controller 0', '--controller 1', '--list']);
  assert.equal(result.controllers.length, 2);
  assert.equal(result.controllers[0].error, 'controllerQueryTimedOut');
  assert.equal(result.controllers[1].children[0].ports.length, 2);
  assert.equal(result.partialFailures, 1);
});

test('keeps the last snapshot when every controller query fails', async () => {
  await assert.rejects(queryControllers('usb-topology.exe', {
    execFileImpl(_executable, args, _options, callback) {
      if (args[0] === '--list') return callback(null, Buffer.from(JSON.stringify({
        version: 1, controllers: [{ type: 'controller', name: 'Controller 1', controllerIndex: 0, children: [] }],
      })));
      return callback(Object.assign(new Error('timeout'), { killed: true }));
    },
  }), { code: 'PROCESS_TIMEOUT' });
});

test('rejects duplicate controller indices before spawning controller queries', async () => {
  let calls = 0;
  await assert.rejects(queryControllers('usb-topology.exe', {
    execFileImpl(_executable, _args, _options, callback) {
      calls += 1;
      callback(null, Buffer.from(JSON.stringify({ version: 1, controllers: [
        { type: 'controller', controllerIndex: 0 },
        { type: 'controller', controllerIndex: 0 },
      ] })));
    },
  }), { code: 'INVALID_TOPOLOGY' });
  assert.equal(calls, 1);
});

test('does not replace a snapshot when controller enumeration reports failure', async () => {
  await assert.rejects(queryControllers('usb-topology.exe', {
    execFileImpl(_executable, _args, _options, callback) {
      callback(null, Buffer.from(JSON.stringify({ version: 1, controllers: [],
        error: 'controllerEnumerationFailed' })));
    },
  }), { code: 'QUERY_FAILED' });
});

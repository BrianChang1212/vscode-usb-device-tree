const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 10_000;
const MAX_NODES = 25_000;
const MAX_DEPTH = 64;

function nativeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateNode(node, state, depth = 0) {
  state.count += 1;
  if (state.count > MAX_NODES) throw nativeError('TOO_MANY_NODES', 'USB topology has too many nodes.');
  if (depth > MAX_DEPTH) throw nativeError('TREE_TOO_DEEP', 'USB topology is too deep.');
  if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.type !== 'string') {
    throw nativeError('INVALID_TOPOLOGY', 'USB topology contains an invalid node.');
  }
  if (node.serialPorts !== undefined) {
    if (!Array.isArray(node.serialPorts) || node.serialPorts.length > 256 || node.serialPorts.some((port) =>
      !port || typeof port !== 'object' || Array.isArray(port) ||
      typeof port.portName !== 'string' || !/^COM[0-9]+$/.test(port.portName) ||
      ['friendlyName', 'instanceId', 'serviceName'].some((key) =>
        port[key] !== undefined && typeof port[key] !== 'string'))) {
      throw nativeError('INVALID_TOPOLOGY', 'USB node serial ports are invalid.');
    }
  }
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) throw nativeError('INVALID_TOPOLOGY', 'USB node children must be an array.');
    for (const child of node.children) validateNode(child, state, depth + 1);
  }
  if (node.ports !== undefined) {
    if (!Array.isArray(node.ports)) throw nativeError('INVALID_TOPOLOGY', 'USB hub ports must be an array.');
    for (const port of node.ports) validateNode(port, state, depth + 1);
  }
}

function parseTopology(stdout, { maxBytes = MAX_OUTPUT_BYTES } = {}) {
  if (Buffer.byteLength(stdout, 'utf8') > maxBytes) {
    throw nativeError('OUTPUT_TOO_LARGE', 'USB topology output exceeded its size limit.');
  }
  let topology;
  try {
    topology = JSON.parse(stdout);
  } catch {
    throw nativeError('MALFORMED_JSON', 'USB topology output was not valid JSON.');
  }
  if (!topology || topology.version !== 1 || !Array.isArray(topology.controllers)) {
    throw nativeError('INVALID_TOPOLOGY', 'USB topology has an unsupported schema.');
  }
  const state = { count: 0 };
  for (const controller of topology.controllers) validateNode(controller, state);
  return topology;
}

function execute(executablePath, { execFileImpl = execFile, timeoutMs = QUERY_TIMEOUT_MS,
  maxOutputBytes = MAX_OUTPUT_BYTES, args = ['--json'] } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(executablePath, args, {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: maxOutputBytes,
      encoding: 'buffer',
    }, (error, stdout) => {
      if (error) {
        if (error.code === 'ENOENT') return reject(nativeError('NATIVE_NOT_FOUND', 'USB topology helper is missing.'));
        if (error.killed || error.code === 'ETIMEDOUT') return reject(nativeError('PROCESS_TIMEOUT', 'USB topology query timed out.'));
        if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(nativeError('OUTPUT_TOO_LARGE', 'USB topology output exceeded its size limit.'));
        return reject(nativeError('QUERY_FAILED', 'USB topology query failed.'));
      }
      const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || '');
      resolve(parseTopology(text, { maxBytes: maxOutputBytes }));
    });
  });
}

async function queryControllers(executablePath, options = {}) {
  const listed = await execute(executablePath, { ...options, args: ['--list'],
    timeoutMs: Math.min(options.timeoutMs ?? QUERY_TIMEOUT_MS, 3000) });
  if (listed.error) throw nativeError('QUERY_FAILED', 'USB controller enumeration failed.');
  if (!listed.controllers.length) return listed;
  const indices = listed.controllers.map((controller) => controller.controllerIndex);
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index > 255) ||
      new Set(indices).size !== indices.length) {
    throw nativeError('INVALID_TOPOLOGY', 'USB controller list has invalid indices.');
  }
  const controllers = [];
  let partialFailures = 0;
  let firstFailure;
  for (let offset = 0; offset < listed.controllers.length; offset += 4) {
    const batch = listed.controllers.slice(offset, offset + 4);
    const results = await Promise.all(batch.map(async (placeholder) => {
      try {
        const topology = await execute(executablePath, { ...options,
          args: ['--controller', String(placeholder.controllerIndex)],
          timeoutMs: Math.min(options.timeoutMs ?? QUERY_TIMEOUT_MS, 6000) });
        const controller = topology.controllers[0];
        if (topology.controllers.length !== 1 ||
            controller.controllerIndex !== placeholder.controllerIndex) {
          throw nativeError('INVALID_TOPOLOGY', 'USB controller index changed during refresh.');
        }
        return { controller };
      } catch (error) {
        return { error, controller: { ...placeholder,
          error: error.code === 'PROCESS_TIMEOUT' ? 'controllerQueryTimedOut' : 'controllerQueryFailed' } };
      }
    }));
    for (const result of results) {
      controllers.push(result.controller);
      if (result.error) {
        partialFailures += 1;
        firstFailure ||= result.error;
      }
    }
  }
  if (partialFailures === controllers.length) throw firstFailure;
  parseTopology(JSON.stringify({ version: 1, controllers }));
  return { version: 1, controllers, partialFailures };
}

async function queryUsbTopology(extensionPath, options = {}) {
  if (os.platform() !== 'win32' || os.arch() !== 'x64') {
    throw nativeError('UNSUPPORTED_PLATFORM', 'USB Device Tree currently supports Windows x64 only.');
  }
  const executable = path.join(extensionPath, 'native', 'bin', 'win32-x64', 'usb-topology.exe');
  return queryControllers(executable, options);
}

module.exports = {
  MAX_DEPTH,
  MAX_NODES,
  MAX_OUTPUT_BYTES,
  QUERY_TIMEOUT_MS,
  execute,
  parseTopology,
  queryControllers,
  queryUsbTopology,
};

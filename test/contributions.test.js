const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = require(path.join(root, 'package.json'));

test('USB Devices is contributed under its own Activity Bar container', () => {
  const container = manifest.contributes.viewsContainers.activitybar.find(
    (entry) => entry.id === 'usbDeviceTree'
  );

  assert.ok(container, 'USB Device Tree Activity Bar container is missing');
  assert.equal(container.title, 'USB Device Tree');
  assert.equal(container.icon, 'resources/usb-device-tree.svg');
  assert.ok(fs.existsSync(path.join(root, container.icon)), 'container icon is missing');

  const views = manifest.contributes.views.usbDeviceTree;
  assert.ok(views.some((view) => view.id === 'usbDeviceTree.devices'));
  assert.equal(manifest.contributes.views.explorer, undefined);
  assert.ok(manifest.activationEvents.includes('onView:usbDeviceTree.devices'));
  assert.ok(manifest.files.includes('resources/'));

  assert.equal(manifest.contributes.configuration.properties['usbDeviceTree.autoRefreshEnabled'].default, true);
  assert.equal(manifest.contributes.configuration.properties['usbDeviceTree.refreshIntervalSeconds'].default, 5);
  assert.ok(manifest.contributes.commands.some((command) => command.command === 'usbDeviceTree.pauseAutoRefresh'));
  assert.ok(manifest.contributes.commands.some((command) => command.command === 'usbDeviceTree.resumeAutoRefresh'));
  const titleMenu = manifest.contributes.menus['view/title'];
  assert.ok(titleMenu.find((item) => item.command === 'usbDeviceTree.pauseAutoRefresh').when.includes('!usbDeviceTree.autoRefreshPaused'));
  assert.ok(titleMenu.find((item) => item.command === 'usbDeviceTree.resumeAutoRefresh').when.includes('usbDeviceTree.autoRefreshPaused'));
});

test('exposes Expand All in the USB view title without adding a command-palette entry', () => {
  const commandId = 'usbDeviceTree.expandAll';
  const command = manifest.contributes.commands.find((entry) => entry.command === commandId);
  const titleAction = manifest.contributes.menus['view/title'].find((entry) => entry.command === commandId);
  const paletteAction = manifest.contributes.menus.commandPalette.find((entry) => entry.command === commandId);

  assert.equal(command.title, 'USB Device Tree: Expand All');
  assert.equal(command.icon, '$(chevron-down)');
  assert.equal(titleAction.when, 'view == usbDeviceTree.devices');
  assert.equal(paletteAction.when, 'false');
  assert.ok(manifest.activationEvents.includes('onCommand:usbDeviceTree.expandAll'));
});

test('packages a self-contained Windows x64 helper without an external executable setting', () => {
  const commands = manifest.contributes.commands.map(({ command }) => command);
  assert.equal(commands.includes('usbDeviceTree.selectExecutable'), false);
  assert.equal(Object.hasOwn(manifest.contributes.configuration.properties, 'usbDeviceTree.executablePath'), false);
  assert.ok(manifest.files.includes('native/bin/win32-x64/usb-topology.exe'));
  assert.equal(manifest.scripts['vscode:prepublish'], 'npm run build:native');
  assert.match(manifest.scripts['package:verify'], /--allow-missing-repository/);
});

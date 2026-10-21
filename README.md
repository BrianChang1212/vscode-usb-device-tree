# VS Code USB Device Tree

![USB Device Tree extension icon](resources/extension-icon.png)

A Windows x64 extension that shows USB host controllers, root hubs, downstream hubs, physical ports, and connected devices in VS Code. Install the VSIX to use it; no separate query tool is required.

The bundled native helper queries the topology through Windows USB device interfaces and read-only USB IOCTL operations, then emits UTF-8 JSON. The extension provides search, detailed information, refresh, and XML snapshots. If one node cannot be queried, the tree retains that node with its error status. If a refresh fails, the last successful tree remains visible.

## Features

- Shows the controller → hub → physical port topology, including disconnected ports. Connected device and downstream hub information appears on the physical port row to avoid duplicate levels.
- Uses a dark USB topology panel with compact controller, hub, and port rows. The details panel shows a device summary and separate Physical Port, USB Device, Windows PnP, and Raw Data tabs.
- Shows device and hub descriptors, USB and device versions, VID/PID, manufacturer/product/serial strings, BOS capabilities, and available configuration descriptors.
- Decodes configuration, interface, and endpoint descriptors; estimates maximum configuration current; and retains raw hexadecimal data.
- Shows supported USB protocols, SuperSpeed capabilities, user-connectable and debug capabilities, Type-C information, and companion port information for each port.
- Shows available Windows PnP information: device description, manufacturer, service, friendly name, location, instance ID, driver key, class/GUID, enumerator, status/problem codes, container ID, power state, device interface paths, and verified driver INF and binary paths. Present PnP descendants appear below their USB device.
- Lists USB4 host routers and their present PnP children separately from USB 3.x controller and hub ports.
- Finds `COM*` serial ports within each USB device's PnP subtree. Port and device labels, serial-port child nodes, and details show the port number, friendly name, source instance ID, and service name.
- Supports search, manual refresh, automatic refresh while the view is visible, and pause/resume controls. USB device-interface changes trigger an earlier refresh; polling every five seconds remains as a fallback. After a successful query, a connected physical port briefly turns green and a disconnected one briefly turns red, then returns to the theme color after about 1.8 seconds. The initial scan and failed queries do not show connection-change colors.
- Expands every visible branch from the USB Devices view title. While search is active, only the filtered results are expanded.
- Exports the project's `<UsbDeviceTreeSnapshot version="1">` XML format.
- Limits query time, output size, node count, and tree depth.

## Supported platforms

- Windows x64 with VS Code `^1.90.0`.
- ARM64 and other operating systems are currently unsupported.
- Available topology and detail fields depend on what Windows, the controller, hub, and device report. The extension does not invent missing information.
- Available detail fields are listed in [Detail coverage](docs/detail-coverage.md). The implemented functionality meets the agreed scope.

## Usage

1. Install the VSIX and open **USB Device Tree** in the VS Code Activity Bar on Windows x64.
2. Click Refresh or wait for automatic refresh while the view is visible.
3. Select a node to inspect the available details, or use Search to locate a device or port.
4. Use **Expand all** or **Collapse** in the USB Devices panel to change the visible tree. The view title also provides **Expand All**.
5. Run **USB Device Tree: Export XML Snapshot** to save the most recent successful snapshot.

After a failed refresh, the view marks the retained data as stale. XML export is unavailable until a query has succeeded.

## Development, testing, and VSIX packaging

Requirements: Node.js 24, npm, Visual Studio 2022 C++ x64 Build Tools, and the Windows SDK.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build:native
npm.cmd run package:verify
```

`npm run package:verify` runs `vscode:prepublish` to build `native/bin/win32-x64/usb-topology.exe`, then creates a local VSIX at `release/usb-device-tree.vsix`. The VSIX contains the compiled helper, so users do not need development tools. Each controller is queried separately: if one times out, other controllers can still update and the failed controller shows an error. If all controllers fail, the last successful data remains visible. A Windows x64 native build and package-content check do not establish that every physical hub topology has been verified.

## Documentation

- [Changelog](docs/changelog.md): version history and manual verification records.
- [Detail coverage](docs/detail-coverage.md): available fields and current scope.
- [Contributing](CONTRIBUTING.md), [Security](SECURITY.md), and [License](LICENSE).

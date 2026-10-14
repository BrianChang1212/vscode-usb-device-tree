# Contributing

This project uses a Windows x64 native helper to read USB topology. The VS Code extension displays the results and exports the project's own XML snapshot format. Do not add a third-party USB tree tool, its executable, or its proprietary report format as a runtime dependency.

## Development environment

- Windows x64, Node.js 24, and npm.
- Visual Studio 2022 C++ x64 Build Tools and the Windows SDK.
- Install local dependencies with `npm.cmd ci`.

## Verification

```powershell
npm.cmd test
npm.cmd run build:native
npm.cmd run package:verify
```

The native build output is `native/bin/win32-x64/usb-topology.exe`, which is required in the VSIX. Do not commit generated `.obj`, `.pdb`, or `.vsix` files. VSIX packaging runs `vscode:prepublish` to build the helper first. Automated tests cover synthetic topologies, limits, error handling, and XML escaping. They do not replace verification of real Windows controller and hub topologies.

## Native enumerator

- Read data only through public Windows device interfaces and USB IOCTLs.
- Emit every port, including disconnected ports. Keep an individual port in the output when its query fails, and record the error on that node.
- Keep the JSON schema version explicit. When adding fields, update JavaScript validation, tree rendering, XML output, and synthetic tests together.
- Emit only device information needed for the feature. Public documentation, test fixtures, issues, and pull requests must not contain real device serial numbers, device paths, or host identifiers.
- Preserve execution-time, output-size, node-count, and depth limits.

## XML snapshot

The root element is `<UsbDeviceTreeSnapshot version="1">`. This is a project-specific format. Escape XML reserved characters in every attribute value, and do not infer data that a device did not report.

Write project documentation in English while preserving technical identifiers, paths, commands, code blocks, and URLs.

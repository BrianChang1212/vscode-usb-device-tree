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

GitHub CI runs these checks on push and pull requests and saves the verified VSIX as a workflow artifact. Run the `Package and Publish VSIX` workflow from the Actions tab on `main` to prepare a downloadable VSIX without publishing it. Before distributing the artifact, check the workflow commit and SHA-256 and install the VSIX in a normal VS Code window.

To publish automatically, create a Marketplace Manage-scope Azure DevOps Personal Access Token (PAT) for publisher `brian-chang` and save it as the GitHub Actions repository secret `VSCE_PAT`. Never commit or print the token. Then push a `v<package.json version>` tag on the release commit, such as `v0.13.0`. The tagged workflow checks the tag against `package.json`, runs tests, builds and verifies the VSIX, publishes that exact VSIX using the secret, and checks the Marketplace version and VSIX SHA-256. A failed publish or readback fails the workflow. Check the Marketplace listing and install the published version in VS Code after the workflow succeeds. Each Marketplace update needs a new package version and matching tag. Rotate the PAT before it expires; Azure DevOps global PATs are scheduled to stop working on December 1, 2026, so this authentication method must be replaced before then.

## Native enumerator

- Read data only through public Windows device interfaces and USB IOCTLs.
- Emit every port, including disconnected ports. Keep an individual port in the output when its query fails, and record the error on that node.
- Keep the JSON schema version explicit. When adding fields, update JavaScript validation, tree rendering, XML output, and synthetic tests together.
- Emit only device information needed for the feature. Public documentation, test fixtures, issues, and pull requests must not contain real device serial numbers, device paths, or host identifiers.
- Preserve execution-time, output-size, node-count, and depth limits.

## XML snapshot

The root element is `<UsbDeviceTreeSnapshot version="1">`. This is a project-specific format. Escape XML reserved characters in every attribute value, and do not infer data that a device did not report.

Write project documentation in English while preserving technical identifiers, paths, commands, code blocks, and URLs.

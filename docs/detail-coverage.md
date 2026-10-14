# USB detail coverage

This document lists the information available in the extension. Standard USB descriptors, Windows topology, and available PnP data are inspectable in VS Code details and in the project's XML snapshots.

Microsoft's public USBView sample recursively enumerates host controllers, root hubs, hubs, and ports, and reads configuration and string descriptors through `IOCTL_USB_GET_DESCRIPTOR_FROM_NODE_CONNECTION`. [USBView sample overview](https://github.com/microsoft/Windows-driver-samples/blob/main/usb/usbview/README.md)

## Current coverage

| Data group | Available fields |
|---|---|
| Topology and ports | Host controllers, root/external hubs, every port (including disconnected ports), connection status, and errors reported by Windows |
| USB device descriptor | VID/PID, device class/subclass/protocol, USB/device version, device address, configuration count, open pipe count, and raw device descriptor |
| Configuration | Every available configuration, interface count, attributes, string index, estimated current converted from `bMaxPower` units, and complete raw bytes |
| Interface/endpoint | Interface number, alternate setting, endpoint count, class/subclass/protocol, endpoint address/direction/transfer type/maximum packet size/interval, and raw bytes |
| Strings and extended descriptors | Available string descriptors for up to eight languages and indices 1–31; decoded USB 2.0 Extension, SuperSpeed BOS capability, and SuperSpeed Endpoint Companion, with raw bytes retained |
| Hub/port capabilities | Hub port count and basic hub characteristics; supported USB protocols, SuperSpeed capability, user-connectable and debug flags, Type-C, and companion port information |
| Windows PnP | Driver key, device description, manufacturer, service, friendly name, location, hardware/compatible IDs, location paths, instance ID, and direct child devnode IDs; setup class/GUID, enumerator, kernel name, address, capabilities, configuration flags, devnode status/problem code, available driver INF/description/provider/version/date, container ID, and reported device power state. Non-hub USB devices also expose their present PnP descendant tree. |
| COM serial ports | Reads `PortName` within the USB device's PnP subtree and shows COM number, friendly name, service, and source instance ID; a device can have multiple COM child nodes |

Details are grouped by physical port, USB device, and downstream hub, with separate sections for descriptors, Windows PnP/COM data, and raw data. Boolean values and common speeds include readable explanations while retaining their raw values. Parsed fields and raw descriptor bytes remain available so that descriptor types without a decoder can still be inspected manually. XML uses the project's `<UsbDeviceTreeSnapshot version="1">` format.

COM attribution follows the USB device's PnP subtree. A physical USB serial device may provide `PortName` on its own devnode, while a Bluetooth device may provide several COM ports through `BTHENUM` descendants. Synthetic fixtures cover both cases, search, and XML escaping. Real device names, COM numbers, and identifiers are not included in public documentation.

The tree view uses instance IDs to avoid creating duplicate COM child nodes. It merges connected device and downstream hub details into the physical port row, while retaining genuine PnP descendants, including COM child nodes.

The native query collects COM descendants only for non-hub USB devices. A hub's PnP subtree may contain devices on other physical ports; collecting the entire hub subtree's COM ports on the hub itself would misattribute and duplicate them.

USB4 host routers and their present PnP descendants are listed separately from USB 3.x host controllers. Their nodes do not claim USB hub ports because the USB 3.x hub IOCTLs do not describe USB4 router ports.

## Validation and scope

The implemented functionality meets the agreed scope. On one Windows host, verification covered five controllers, thirteen root-port connection states, COM attribution, and the parent-child relationships of seventy-two present PnP descendants. Automated tests, a Windows x64 native build, VSIX content inspection, and execution of the installed helper also completed successfully. Raw device reports remain local and are not included in the repository.

Class-specific descriptor decoding, disk and volume details, USB4 physical-port details, and further VS Code GUI testing are outside this delivery's scope. The extension reports only information available from Windows and connected hardware; unavailable values are not inferred. String scanning is limited to eight languages and descriptor indices 1–31.

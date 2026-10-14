# Changelog

## 2026-10-14 — 0.11.1 — Fix — English interface text

- Translated Details headings, field labels, status values, and related tree and command messages into English.
- Updated existing UI expectations and the package version for the next extension release.

## 2026-10-14 — 0.11.0 — Feature — PnP and USB4 detail coverage

- Added the present USB4 host router and its PnP children without claiming USB4 ports that the USB 3.x hub queries cannot supply.
- Added the PnP descendant tree under non-hub USB devices, with instance ID based COM deduplication.
- Added available container IDs, power states, hardware and driver properties, verified INF and service binary paths, and device interface paths to details and project XML snapshots.
- Confirmed controller and root-port data, COM attribution, and PnP relationships on the tested host. Raw device reports remain local. The implemented functionality meets the agreed scope.

## 2026-10-14 — 0.10.1 — UI — Extension icon and documentation

- Added a dedicated USB topology icon for the VS Code extension listing. A controller node and three branches on a dark background represent the controller, hub, and ports.
- Displayed the same extension icon at the beginning of the README.
- Simplified installation and error-reporting guidance shown to users, without requiring a separate query tool or its version.

## 2026-10-14 — 0.10.0 — Feature — USB change notifications and port colors

- The Windows x64 native helper listens for USB device-interface arrival and removal notifications and requests an earlier refresh. Timed polling while the view is visible remains a fallback.
- Changes are determined by comparing the state of the same physical port across successful queries. Newly connected ports briefly appear green; disconnected ports briefly appear red. The color returns to the theme color after about 1.8 seconds. The initial scan and failed queries do not show connection-change colors.
- The user manually confirmed that connection-change refresh and colors meet the requested behavior.

## 2026-10-14 — 0.9.2 — Fix — Manual refresh

- Fixed an error when the manual refresh command received a `null` argument after first opening the USB view. The user manually confirmed that refresh works.

## 2026-10-13 — Feature — Initial Windows USB topology

- Added a project-built Windows x64 native helper to query controllers, hubs, physical ports, and devices, with search, details, automatic refresh, and project-specific XML snapshots.
- If an individual controller query fails, data from available controllers is retained. If all queries fail, the last successful snapshot remains visible and is marked stale.

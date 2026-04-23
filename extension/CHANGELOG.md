# Changelog

## 0.2.18

- Add a manual stop command for the current conversation retry
- Add a proxy stop endpoint and tooltip action for stopping an active retry loop

## 0.2.17

- Validate that open Antigravity windows auto-reload after an external VSIX install once the watcher is bootstrapped

## 0.2.16

- Keep the installed-version watcher alive across status-bar refresh restarts so auto-reload actually triggers

## 0.2.15

- Add automatic window reload when the running extension detects a newer installed version in `~/.antigravity/extensions/extensions.json`

## 0.2.14

- Bootstrap automatic reload support for future extension upgrades

## 0.2.13

- Clear stale `Cascade ID` values while idle

## 0.2.12

- Resolve the active cascade per workspace window instead of reading any available active cascade globally

## 0.2.11

- Add workspace-window based cascade scoping diagnostics while debugging the multi-window state model

## 0.2.10

- Decode `uss-activeCascadeIds` row payloads when Antigravity stores the active cascade as a base64-encoded protobuf value
- Fall back to non-workspace keyed unified-state entries such as `"1"` when resolving the current conversation

## 0.2.9

- Serialize unified-state diagnostics safely when Antigravity returns `BigInt` values

## 0.2.8

- Read Antigravity unified state topics through `getState()` instead of the incompatible `get()` path
- Keep `uss-activeCascadeIds` subscriptions in sync with the extension-host API shape

## 0.2.7

- Subscribe to Antigravity's `uss-activeCascadeIds` unified state topic
- Scope retry status to the active conversation for the current workspace when `status.cascades` is available
- Include the active cascade state in the diagnostic context dump

## 0.2.6

- Include workbench trace, manager trace, and manager status command results in the diagnostic context dump

## 0.2.5

- Include the return value of `antigravity.getDiagnostics` in the diagnostic context dump

## 0.2.4

- Save the diagnostic context dump to a local JSON file in the OS temp directory

## 0.2.3

- Add a diagnostic command to dump active tab and Antigravity command context into the output channel

## 0.2.2

- Show `Retry Failed` as an error state instead of falling back to the idle indicator

## 0.2.1

- Show the request model in the tooltip and recent event log when available

## 0.2.0

- Translate all user-facing strings to English
- Show `0` by default while idle
- Keep retry intervals and polling configurable

## 0.1.0

- Initial release
- Show retry count in the status bar
- Show recent retry events in tooltip and output channel
- Highlight quota exhaustion in the status bar

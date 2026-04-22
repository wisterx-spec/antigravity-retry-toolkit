# Retry Status Bar

Show retry activity in the VS Code status bar.

The extension displays:

- the current retry attempt
- the current request model when available
- the latest error summary
- the final `Retry Failed` state when retries are exhausted
- recent retry / recovered / quota events

Default status endpoint:

- `http://127.0.0.1:38475/__status`

## Features

- show the current retry count in the status bar
- highlight quota exhaustion as `Quota Exceeded`
- show recent events in the tooltip
- write event history to an output channel

## Settings

- `retryStatusBar.statusUrl`
- `retryStatusBar.pollIntervalMs`
- `retryStatusBar.showWhenIdle`
- `retryStatusBar.idleText`
- `retryStatusBar.maxTooltipEvents`

## Commands

- `Retry Status Bar: Show Log`
- `Retry Status Bar: Refresh`
- `Retry Status Bar: Dump Antigravity Context`
  This command also saves the JSON payload to the OS temp directory as `retry-status-bar-context.json`.

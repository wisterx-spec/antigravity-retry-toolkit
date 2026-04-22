# Antigravity Retry Toolkit

Antigravity Retry Toolkit adds two capabilities to Antigravity:

- automatic retry for transient cloud capacity failures
- a status bar extension that shows retry state, recent errors, and hard quota issues

This repository is organized so it can be pushed to GitHub directly.

## Status

- Current version: `0.2.17`
- Platform target: macOS
- Retry proxy status: verified locally
- Multi-window conversation scoping: verified locally
- Automatic extension reload after external VSIX install: verified locally

## Screenshots

The status bar extension shows live retry state, cascade scoping, model name, and recent retry events directly inside Antigravity.

![Retry status tooltip and status bar](docs/screenshots/retry-status.png)

## License

- [MIT](LICENSE)

## Repository layout

- `proxy/`
  Local retry proxy source
- `scripts/`
  Install and uninstall scripts for the proxy launch agent
- `extension/`
  VS Code / Antigravity status bar extension source and packaged VSIX
- `dist/`
  Prebuilt release archive

## Components

### Retry proxy

Source:

- [proxy/antigravity-cloudcode-proxy.js](proxy/antigravity-cloudcode-proxy.js)

Behavior:

- retries `503`, transient `429`, and transport failures
- passes through hard quota exhaustion immediately
- exposes:
  - `__health`
  - `__status`
- stores recent retry events in memory for the status bar extension

### Status bar extension

Source:

- [extension/package.json](extension/package.json)
- [extension/extension.js](extension/extension.js)

Packaged VSIX:

- [extension/retry-status-bar-0.2.17.vsix](extension/retry-status-bar-0.2.17.vsix)

Behavior:

- shows retry attempts as `1`, `2`, `3`
- shows hard quota failures as `Quota Exceeded`
- shows `Recovered` after a successful retry cycle
- can show `0` while idle
- exposes recent events in tooltip and output channel

## Quick start

### 1. Install the proxy

```bash
cd scripts
chmod +x install-proxy.sh uninstall-proxy.sh
./install-proxy.sh
```

### 2. Point Antigravity to the local proxy

Add this to Antigravity user settings:

```json
{
  "jetski.cloudCodeUrl": "http://127.0.0.1:38475"
}
```

### 3. Install the status bar extension

Inside Antigravity:

1. Run `Extensions: Install from VSIX...`
2. Choose `extension/retry-status-bar-0.2.17.vsix`
3. Run `Developer: Reload Window`

## Local development loop

For a repeatable local code -> package -> install -> smoke-test loop, run:

```bash
cd /Users/wister.xue/Desktop/workspace/antigravity-retry-toolkit
chmod +x scripts/*.sh
./scripts/dev-loop.sh
```

What it does:

- syntax-checks the proxy, extension, and install scripts
- packages the latest VSIX
- installs the VSIX directly into `~/.antigravity/extensions`
- reinstalls the local proxy launch agent
- verifies `__health` and `__status`
- leaves a dedicated verification step available via `scripts/verify-dev-loop.sh`

If you only want to install a prebuilt VSIX without packaging again:

```bash
./scripts/install-extension.sh extension/retry-status-bar-0.2.17.vsix
```

If you want a pass/fail verification report and automatic Antigravity window reload:

```bash
./scripts/verify-dev-loop.sh --reload-windows
```

If you want the reload step to fail fast instead of waiting the default `30s`:

```bash
RETRY_TOOLKIT_WINDOW_RELOAD_TIMEOUT_SECONDS=5 ./scripts/verify-dev-loop.sh --reload-windows
```

Current limitation:

- `scripts/reload-antigravity-windows.sh` is best-effort. On some Antigravity builds, macOS accessibility automation can hang while switching windows, so `verify-dev-loop.sh --reload-windows` can still fail even though the in-extension auto-reload path works

Auto reload note:

- From `0.2.14` onward, the running extension watches `~/.antigravity/extensions/extensions.json`
- If it detects that the installed version of `wister-xue.retry-status-bar` changed, it will trigger `workbench.action.reloadWindow` automatically
- This behavior has been verified locally for `0.2.16 -> 0.2.17`

## Configurable retry settings

The proxy reads configuration from environment variables.

- `ANTIGRAVITY_PROXY_PORT`
- `ANTIGRAVITY_PROXY_TARGET_HOST`
- `ANTIGRAVITY_PROXY_MAX_ATTEMPTS`
- `ANTIGRAVITY_PROXY_BASE_DELAY_MS`
- `ANTIGRAVITY_PROXY_MAX_DELAY_MS`
- `ANTIGRAVITY_PROXY_STATUS_HOLD_MS`
- `ANTIGRAVITY_PROXY_QUOTA_STATUS_HOLD_MS`
- `ANTIGRAVITY_PROXY_EVENT_HISTORY_LIMIT`
- `ANTIGRAVITY_PROXY_DEBUG_REQUEST_IDENTIFIERS`

The default install script writes those values into the generated `launchd` plist.
By default, retry delays are capped at `5000ms`, so even if the upstream response suggests retrying after `15s`, the local proxy waits at most `5s`.
Set `ANTIGRAVITY_PROXY_DEBUG_REQUEST_IDENTIFIERS=1` to log candidate request identifiers such as `cascadeId`, `conversationId`, `sessionId`, `requestId`, `threadId`, and `chatId` without dumping the full request body.

## Release artifact

This repo also includes a prebuilt distribution zip:

- [dist/antigravity-retry-toolkit.zip](dist/antigravity-retry-toolkit.zip)

## CI

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs shell syntax checks, JavaScript syntax checks, and VSIX packaging on GitHub Actions

## Notes

- This repository does not include the floating overlay version.
- The retry proxy and extension have been tested locally, but there is no full end-to-end headless UI test suite yet.

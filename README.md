# Antigravity Retry Toolkit

A small macOS toolkit for Antigravity users who want transient model/backend failures to retry automatically and become visible instead of failing silently.

Antigravity Retry Toolkit adds two capabilities to Antigravity:

- automatic retry for transient cloud capacity failures
- a status bar extension that shows retry state, recent errors, and quota failures

This repository is organized so it can be pushed to GitHub directly.

## Common failure symptoms

This toolkit is meant for Antigravity users who repeatedly hit problems like:

- `Agent terminated due to error`
- `429 rate limiting`
- `503 server overload`
- connection failures or transient transport errors
- repeated manual retries with no clear visibility into what is happening

## Why this exists

In the default Antigravity experience, transient upstream failures are painful to work with:

- the agent can stop on a temporary `503` or capacity error
- retrying by hand is repetitive and easy to lose track of
- there is no clear built-in view of which attempt is running, what model failed, or whether the request recovered

This toolkit fixes that by adding a local retry proxy and a lightweight status bar view inside Antigravity.

## What you get

- automatic retry for temporary upstream failures such as `503`, transport errors, and retryable `429`
- immediate pass-through for hard quota exhaustion, so real quota errors are still visible
- live retry status in Antigravity: attempt count, current error, model, endpoint, recent retry history, and a manual stop action
- multi-window, multi-conversation status isolation, so one window does not leak retry state into another
- local development scripts for packaging, installing, verifying, and reloading the extension
- a non-invasive integration model: this project does not modify files inside `Antigravity.app`; it works through a local proxy, user-level settings, and a separately installed extension

## Status

- Current version: `0.2.24`
- Platform target: macOS
- Retry proxy status: verified locally
- Multi-window, multi-conversation status isolation: verified locally
- Real retry flows verified across separate conversations, including transient `503` retries and quota-style `429` handling
- Automatic extension reload after external VSIX install: verified locally

## Known limits and unverified risks

- Verified on local macOS setups only. This repository has not been validated on Windows or Linux.
- Verified against real transient `503` and quota-style `429` flows locally, but not against a broad matrix of upstream failure modes or long-running production traffic.
- Multi-window, multi-conversation isolation has been verified locally, but not stress-tested under sustained high parallel request load.
- The proxy currently has no separate max-concurrency control. Very high local parallelism may still increase upstream throttling rather than improve recovery.
- Retry status lives in memory. If the proxy process restarts, in-flight retry history and current UI state are lost.
- The setup depends on Antigravity internals such as `jetski.cloudCodeUrl`, local extension installation behavior, and current window/context signals. Future Antigravity builds could change those integration points.
- Automatic window reload after external VSIX install has been verified locally, but there is no full headless end-to-end UI test suite yet.

## Screenshots

Before: Antigravity can stop on a transient upstream error and leave you with a manual retry loop.

<img width="452" height="258" alt="Antigravity transient error example" src="https://github.com/user-attachments/assets/6ffd520a-5710-4b3a-88dc-db533da0471a" />

After: the extension shows live retry state, conversation ID, model name, and recent retry events directly inside Antigravity.

<img width="1033" height="400" alt="Retry status tooltip and status bar" src="https://github.com/user-attachments/assets/b51d8ecc-125f-48c0-8699-c7bb0d5e2f22" />


## How it works

### Retry proxy

Source:

- [proxy/antigravity-cloudcode-proxy.js](proxy/antigravity-cloudcode-proxy.js)

Behavior:

- retries `503`, transient `429`, and transport failures
- passes through hard quota exhaustion immediately
- exposes `__health` and `__status`
- stores recent retry events in memory for the status bar extension

### Status bar extension

Source:

- [extension/package.json](extension/package.json)
- [extension/extension.js](extension/extension.js)

Packaged VSIX:

- [extension/retry-status-bar-0.2.24.vsix](extension/retry-status-bar-0.2.24.vsix)

Behavior:

- shows retry attempts as `1`, `2`, `3`
- shows hard quota failures as `Quota Exceeded`
- shows `Recovered` after a successful retry cycle
- can show `0` while idle
- shows recent events in the tooltip and output channel
- lets you stop the current conversation retry manually from the tooltip or command palette
- adds a persistent `Toolkit On` / `Toolkit Off` status bar toggle for enabling or pausing the whole toolkit without opening the command palette

## Quick start

### 1. Install the local retry proxy

```bash
cd scripts
chmod +x install-proxy.sh uninstall-proxy.sh
./install-proxy.sh
```

### 2. Point Antigravity at the local proxy

Add this to Antigravity user settings:

```json
{
  "jetski.cloudCodeUrl": "http://127.0.0.1:38475"
}
```

`jetski.cloudCodeUrl` is the Antigravity setting that controls which backend URL the app uses for cloud code requests. Here, it is redirected to the local retry proxy.

### 3. Install the status bar extension

Inside Antigravity:

1. Run `Extensions: Install from VSIX...`
2. Choose `extension/retry-status-bar-0.2.24.vsix`
3. Run `Developer: Reload Window`

### 4. Stop a retry manually

If you want to stop the retry loop for the current conversation:

1. Run `Retry Status Bar: Stop Current Retry` from the command palette
2. Or click `Stop retry` in the status tooltip while a retry is active

This stops the local retry loop for the active conversation. It does not patch or modify `Antigravity.app`.

### 5. Turn The Toolkit On Or Off

If you want a single switch for the whole toolkit, use:

```bash
./scripts/toolkit-control.sh on
./scripts/toolkit-control.sh off
./scripts/toolkit-control.sh status
./scripts/toolkit-control.sh restart
./scripts/toolkit-control.sh uninstall
```

What it does:

- `on`: starts the local proxy and points Antigravity `jetski.cloudCodeUrl` to `http://127.0.0.1:38475`
- `off`: stops the local proxy and restores the previous `jetski.cloudCodeUrl` value
- `status`: shows whether Antigravity settings are currently pointing at the toolkit proxy and whether the proxy is loaded
- `restart`: restarts the proxy and keeps the toolkit enabled
- `uninstall`: restores the previous `jetski.cloudCodeUrl`, removes the proxy launch agent, deletes toolkit state/log files, and uninstalls the retry status bar extension from `~/.antigravity/extensions`

## Repository layout

- `proxy/`
  Local retry proxy source
- `scripts/`
  Install, uninstall, packaging, reload, and verification scripts
- `extension/`
  Antigravity / VS Code status bar extension source and packaged VSIX
- `dist/`
  Prebuilt release archive

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
./scripts/install-extension.sh extension/retry-status-bar-0.2.24.vsix
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

- `scripts/reload-antigravity-windows.sh` only tries to reload open Antigravity windows through macOS accessibility automation. On some Antigravity builds, window switching can hang, so `verify-dev-loop.sh --reload-windows` can still fail even though the in-extension auto-reload path works

Auto reload note:

- From `0.2.14` onward, the running extension watches `~/.antigravity/extensions/extensions.json`
- If it detects that the installed version of `wister-xue.retry-status-bar` changed, it will trigger `workbench.action.reloadWindow` automatically
- This behavior was verified locally during the `v0.2.24` release prep.

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
- `ANTIGRAVITY_PROXY_ATTEMPT_HISTORY_LIMIT`
- `ANTIGRAVITY_PROXY_ATTEMPT_LOG_PATH`
- `ANTIGRAVITY_PROXY_DEBUG_REQUEST_IDENTIFIERS`

The default install script writes those values into the generated `launchd` plist.
By default, retry delays are capped at `5000ms`, so even if the upstream response suggests retrying after `15s`, the local proxy waits at most `5s`.
Set `ANTIGRAVITY_PROXY_DEBUG_REQUEST_IDENTIFIERS=1` to log candidate request identifiers such as `cascadeId`, `conversationId`, `sessionId`, `requestId`, `threadId`, and `chatId` without dumping the full request body.

## Diagnosing upstream hotspots

The proxy now keeps a short per-attempt diagnostic history in `GET /__status`, in the extension diagnostic dump, and in a JSONL file at `~/Library/Logs/antigravity-cloudcode-proxy-attempts.jsonl` by default.
Each attempt records:

- a safe request-header allowlist such as `user-agent`, `x-goog-api-client`, `x-client-data`, `traceparent`, `grpc-timeout`, and `x-request-id`
- the selected upstream IP and port
- DNS / connect / TLS / first-byte / total timing
- whether the socket was reused
- HTTP version
- a small allowlist of upstream headers such as `retry-after`, `x-envoy-upstream-service-time`, `server`, `via`, and `alt-svc`

This does not prove Google routed a request to a specific overloaded machine, but it gives you enough evidence to answer narrower questions:

- Do failures cluster on a small set of upstream IPs?
- Do bad attempts have much higher `x-envoy-upstream-service-time` or `firstByteMs`?
- Are retries failing on the same connection pattern but succeeding after a fresh resolution?
- Is the issue a hard quota-style `429`, or a transient capacity / transport problem?

## Release artifact

This repo also includes a prebuilt distribution zip:

- [dist/antigravity-retry-toolkit.zip](dist/antigravity-retry-toolkit.zip)

## License

- [MIT](LICENSE)

## CI

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs shell syntax checks, JavaScript syntax checks, and VSIX packaging on GitHub Actions

## Notes

- This repository does not include the floating overlay version.
- The retry proxy and extension have been tested locally, but there is no full end-to-end headless UI test suite yet.

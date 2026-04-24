#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROXY_DIR="${REPO_DIR}/proxy"
PROXY_SCRIPT="${PROXY_DIR}/antigravity-cloudcode-proxy.js"
NODE_BIN="$(command -v node)"
LABEL="com.wister.antigravity-cloudcode-proxy"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_PATH="$HOME/Library/Logs/antigravity-cloudcode-proxy.log"
PROXY_PORT="${ANTIGRAVITY_PROXY_PORT:-38475}"
TARGET_HOST="${ANTIGRAVITY_PROXY_TARGET_HOST:-daily-cloudcode-pa.googleapis.com}"
MAX_ATTEMPTS="${ANTIGRAVITY_PROXY_MAX_ATTEMPTS:-15}"
BASE_DELAY_MS="${ANTIGRAVITY_PROXY_BASE_DELAY_MS:-3000}"
MAX_DELAY_MS="${ANTIGRAVITY_PROXY_MAX_DELAY_MS:-5000}"
STATUS_HOLD_MS="${ANTIGRAVITY_PROXY_STATUS_HOLD_MS:-5000}"
QUOTA_STATUS_HOLD_MS="${ANTIGRAVITY_PROXY_QUOTA_STATUS_HOLD_MS:-20000}"
EVENT_HISTORY_LIMIT="${ANTIGRAVITY_PROXY_EVENT_HISTORY_LIMIT:-25}"
ATTEMPT_HISTORY_LIMIT="${ANTIGRAVITY_PROXY_ATTEMPT_HISTORY_LIMIT:-10}"
ATTEMPT_LOG_PATH="${ANTIGRAVITY_PROXY_ATTEMPT_LOG_PATH:-$HOME/Library/Logs/antigravity-cloudcode-proxy-attempts.jsonl}"
DEBUG_REQUEST_IDENTIFIERS="${ANTIGRAVITY_PROXY_DEBUG_REQUEST_IDENTIFIERS:-0}"
STREAM_FRESH_CONNECT="${ANTIGRAVITY_PROXY_STREAM_FRESH_CONNECT:-1}"
STREAM_FRESH_CONNECT_ON_FIRST_ATTEMPT="${ANTIGRAVITY_PROXY_STREAM_FRESH_CONNECT_ON_FIRST_ATTEMPT:-0}"
STREAM_BAD_ADDRESS_TTL_MS="${ANTIGRAVITY_PROXY_STREAM_BAD_ADDRESS_TTL_MS:-300000}"
STREAM_ADDRESS_SIGNAL_TTL_MS="${ANTIGRAVITY_PROXY_STREAM_ADDRESS_SIGNAL_TTL_MS:-600000}"
STREAM_SLOW_SUCCESS_MS="${ANTIGRAVITY_PROXY_STREAM_SLOW_SUCCESS_MS:-15000}"
STREAM_TOTAL_BUDGET_MS="${ANTIGRAVITY_PROXY_STREAM_TOTAL_BUDGET_MS:-90000}"
STREAM_MIN_REMAINING_BUDGET_MS="${ANTIGRAVITY_PROXY_STREAM_MIN_REMAINING_BUDGET_MS:-5000}"
STREAM_CAPACITY_429_BACKOFF_MS="${ANTIGRAVITY_PROXY_STREAM_CAPACITY_429_BACKOFF_MS:-5000}"

if [[ -z "${NODE_BIN}" ]]; then
  echo "node not found in PATH"
  exit 1
fi

if [[ ! -f "${PROXY_SCRIPT}" ]]; then
  echo "proxy script not found: ${PROXY_SCRIPT}"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${PROXY_SCRIPT}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${PROXY_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ANTIGRAVITY_PROXY_PORT</key>
    <string>${PROXY_PORT}</string>
    <key>ANTIGRAVITY_PROXY_TARGET_HOST</key>
    <string>${TARGET_HOST}</string>
    <key>ANTIGRAVITY_PROXY_MAX_ATTEMPTS</key>
    <string>${MAX_ATTEMPTS}</string>
    <key>ANTIGRAVITY_PROXY_BASE_DELAY_MS</key>
    <string>${BASE_DELAY_MS}</string>
    <key>ANTIGRAVITY_PROXY_MAX_DELAY_MS</key>
    <string>${MAX_DELAY_MS}</string>
    <key>ANTIGRAVITY_PROXY_STATUS_HOLD_MS</key>
    <string>${STATUS_HOLD_MS}</string>
    <key>ANTIGRAVITY_PROXY_QUOTA_STATUS_HOLD_MS</key>
    <string>${QUOTA_STATUS_HOLD_MS}</string>
    <key>ANTIGRAVITY_PROXY_EVENT_HISTORY_LIMIT</key>
    <string>${EVENT_HISTORY_LIMIT}</string>
    <key>ANTIGRAVITY_PROXY_ATTEMPT_HISTORY_LIMIT</key>
    <string>${ATTEMPT_HISTORY_LIMIT}</string>
    <key>ANTIGRAVITY_PROXY_ATTEMPT_LOG_PATH</key>
    <string>${ATTEMPT_LOG_PATH}</string>
    <key>ANTIGRAVITY_PROXY_DEBUG_REQUEST_IDENTIFIERS</key>
    <string>${DEBUG_REQUEST_IDENTIFIERS}</string>
    <key>ANTIGRAVITY_PROXY_STREAM_FRESH_CONNECT</key>
    <string>${STREAM_FRESH_CONNECT}</string>
    <key>ANTIGRAVITY_PROXY_STREAM_FRESH_CONNECT_ON_FIRST_ATTEMPT</key>
    <string>${STREAM_FRESH_CONNECT_ON_FIRST_ATTEMPT}</string>
    <key>ANTIGRAVITY_PROXY_STREAM_BAD_ADDRESS_TTL_MS</key>
    <string>${STREAM_BAD_ADDRESS_TTL_MS}</string>
    <key>ANTIGRAVITY_PROXY_STREAM_ADDRESS_SIGNAL_TTL_MS</key>
    <string>${STREAM_ADDRESS_SIGNAL_TTL_MS}</string>
    <key>ANTIGRAVITY_PROXY_STREAM_SLOW_SUCCESS_MS</key>
    <string>${STREAM_SLOW_SUCCESS_MS}</string>
    <key>ANTIGRAVITY_PROXY_STREAM_TOTAL_BUDGET_MS</key>
    <string>${STREAM_TOTAL_BUDGET_MS}</string>
    <key>ANTIGRAVITY_PROXY_STREAM_MIN_REMAINING_BUDGET_MS</key>
    <string>${STREAM_MIN_REMAINING_BUDGET_MS}</string>
    <key>ANTIGRAVITY_PROXY_STREAM_CAPACITY_429_BACKOFF_MS</key>
    <string>${STREAM_CAPACITY_429_BACKOFF_MS}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
</dict>
</plist>
EOF

launchctl enable "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true

echo "installed proxy: ${PLIST_PATH}"
echo "health: curl http://127.0.0.1:${PROXY_PORT}/__health"

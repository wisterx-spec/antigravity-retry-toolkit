#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_SCRIPT="${SCRIPT_DIR}/install-proxy.sh"
LABEL="com.wister.antigravity-cloudcode-proxy"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
SETTINGS_DIR="$HOME/Library/Application Support/Antigravity/User"
SETTINGS_PATH="${SETTINGS_DIR}/settings.json"
STATE_PATH="${SETTINGS_DIR}/antigravity-retry-toolkit-state.json"
EXTENSIONS_HOME="${HOME}/.antigravity/extensions"
REGISTRY_PATH="${EXTENSIONS_HOME}/extensions.json"
OBSOLETE_PATH="${EXTENSIONS_HOME}/.obsolete"
EXTENSION_ID="wister-xue.retry-status-bar"
PROXY_PORT="${ANTIGRAVITY_PROXY_PORT:-38475}"
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
LAUNCHD_TARGET="gui/$(id -u)/${LABEL}"
LAUNCHD_DOMAIN="gui/$(id -u)"
PROXY_LOG_PATH="${HOME}/Library/Logs/antigravity-cloudcode-proxy.log"
ATTEMPT_LOG_PATH="${HOME}/Library/Logs/antigravity-cloudcode-proxy-attempts.jsonl"

usage() {
  cat <<EOF
Usage: ./scripts/toolkit-control.sh <on|off|status|restart|uninstall>

  on       Enable the retry toolkit and point Antigravity at the local proxy
  off      Disable the retry toolkit and restore the previous cloud code URL
  status   Show the current proxy and settings status
  restart  Restart the local proxy and keep the toolkit enabled
  uninstall Disable the toolkit, remove the proxy launch agent, and uninstall the retry extension
EOF
}

ensure_settings_file() {
  mkdir -p "${SETTINGS_DIR}"
  if [[ ! -f "${SETTINGS_PATH}" ]]; then
    printf '{}\n' > "${SETTINGS_PATH}"
  fi
}

update_settings() {
  local mode="$1"
  ensure_settings_file

  node - "${SETTINGS_PATH}" "${STATE_PATH}" "${PROXY_URL}" "${mode}" <<'NODE'
const fs = require("fs");

const [settingsPath, statePath, proxyUrl, mode] = process.argv.slice(2);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const settings = readJson(settingsPath, {});
const state = readJson(statePath, {});
const currentUrl = settings["jetski.cloudCodeUrl"];

if (mode === "enable") {
  if (currentUrl !== proxyUrl) {
    if (typeof currentUrl === "string" && currentUrl.trim()) {
      state.previousCloudCodeUrl = currentUrl;
      state.hadPreviousCloudCodeUrl = true;
    } else {
      delete state.previousCloudCodeUrl;
      state.hadPreviousCloudCodeUrl = false;
    }
    settings["jetski.cloudCodeUrl"] = proxyUrl;
    writeJson(settingsPath, settings);
  }

  state.enabled = true;
  state.proxyUrl = proxyUrl;
  state.updatedAt = new Date().toISOString();
  writeJson(statePath, state);
  process.stdout.write(`settings_enabled=${settings["jetski.cloudCodeUrl"]}\n`);
  process.exit(0);
}

if (mode === "disable") {
  if (state.hadPreviousCloudCodeUrl && typeof state.previousCloudCodeUrl === "string" && state.previousCloudCodeUrl.trim()) {
    settings["jetski.cloudCodeUrl"] = state.previousCloudCodeUrl;
  } else {
    delete settings["jetski.cloudCodeUrl"];
  }

  writeJson(settingsPath, settings);
  state.enabled = false;
  state.proxyUrl = proxyUrl;
  state.updatedAt = new Date().toISOString();
  writeJson(statePath, state);
  process.stdout.write(`settings_enabled=${settings["jetski.cloudCodeUrl"] || ""}\n`);
  process.exit(0);
}

if (mode === "status") {
  const output = {
    settingsPath,
    statePath,
    currentCloudCodeUrl: typeof currentUrl === "string" ? currentUrl : "",
    proxyUrl,
    toolkitEnabledInSettings: currentUrl === proxyUrl,
    rememberedPreviousCloudCodeUrl: state.previousCloudCodeUrl || "",
    stateEnabled: Boolean(state.enabled),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(0);
}

process.stderr.write(`unknown mode: ${mode}\n`);
process.exit(1);
NODE
}

proxy_status() {
  local loaded="false"
  if launchctl print "${LAUNCHD_TARGET}" >/dev/null 2>&1; then
    loaded="true"
  fi

  printf 'proxy_plist=%s\n' "${PLIST_PATH}"
  printf 'proxy_plist_exists=%s\n' "$([[ -f "${PLIST_PATH}" ]] && echo true || echo false)"
  printf 'proxy_loaded=%s\n' "${loaded}"
}

start_proxy() {
  if [[ ! -f "${PLIST_PATH}" ]]; then
    "${INSTALL_SCRIPT}"
    return
  fi

  launchctl enable "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true
  launchctl bootstrap "${LAUNCHD_DOMAIN}" "${PLIST_PATH}" >/dev/null 2>&1 || true
  launchctl kickstart -k "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true
}

stop_proxy() {
  if [[ ! -f "${PLIST_PATH}" ]]; then
    return
  fi

  launchctl bootout "${LAUNCHD_DOMAIN}" "${PLIST_PATH}" >/dev/null 2>&1 || true
  launchctl disable "${LAUNCHD_TARGET}" >/dev/null 2>&1 || true
}

cleanup_toolkit_artifacts() {
  rm -f "${PLIST_PATH}" "${STATE_PATH}" "${PROXY_LOG_PATH}" "${ATTEMPT_LOG_PATH}"
}

uninstall_extension() {
  mkdir -p "${EXTENSIONS_HOME}"

  node - "${EXTENSIONS_HOME}" "${REGISTRY_PATH}" "${OBSOLETE_PATH}" "${EXTENSION_ID}" <<'NODE'
const fs = require("fs");
const path = require("path");

const [extensionsHome, registryPath, obsoletePath, extensionId] = process.argv.slice(2);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

const registry = readJson(registryPath, []);
const nextRegistry = Array.isArray(registry)
  ? registry.filter((entry) => entry?.identifier?.id !== extensionId)
  : [];
fs.writeFileSync(registryPath, `${JSON.stringify(nextRegistry, null, 2)}\n`, "utf8");

const obsolete = readJson(obsoletePath, {});
for (const key of Object.keys(obsolete)) {
  if (key.startsWith(`${extensionId}-`)) {
    delete obsolete[key];
  }
}

for (const name of fs.readdirSync(extensionsHome)) {
  if (!name.startsWith(`${extensionId}-`)) {
    continue;
  }
  obsolete[name] = true;
  fs.rmSync(path.join(extensionsHome, name), { recursive: true, force: true });
}

fs.writeFileSync(obsoletePath, `${JSON.stringify(obsolete, null, 2)}\n`, "utf8");
NODE
}

action="${1:-status}"

case "${action}" in
  on|enable)
    start_proxy
    update_settings "enable"
    echo "toolkit=enabled"
    echo "proxy_url=${PROXY_URL}"
    ;;
  off|disable)
    update_settings "disable"
    stop_proxy
    echo "toolkit=disabled"
    ;;
  restart)
    stop_proxy
    start_proxy
    update_settings "enable"
    echo "toolkit=restarted"
    echo "proxy_url=${PROXY_URL}"
    ;;
  uninstall)
    update_settings "disable"
    stop_proxy
    cleanup_toolkit_artifacts
    uninstall_extension
    echo "toolkit=uninstalled"
    ;;
  status)
    update_settings "status"
    proxy_status
    ;;
  *)
    usage
    exit 1
    ;;
esac

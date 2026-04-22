#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXTENSION_DIR="${REPO_DIR}/extension"
PROXY_DIR="${REPO_DIR}/proxy"
PROXY_SCRIPT="${PROXY_DIR}/antigravity-cloudcode-proxy.js"
EXTENSION_SCRIPT="${EXTENSION_DIR}/extension.js"
PACKAGE_JSON="${EXTENSION_DIR}/package.json"
STATUS_URL="${RETRY_TOOLKIT_STATUS_URL:-http://127.0.0.1:38475/__status}"
HEALTH_URL="${RETRY_TOOLKIT_HEALTH_URL:-http://127.0.0.1:38475/__health}"
PACKAGE_EXTENSION=1
INSTALL_EXTENSION=1
INSTALL_PROXY=1

usage() {
  cat <<'EOF'
Usage: ./scripts/dev-loop.sh [options]

Runs the local development loop:
1. syntax checks
2. package the Antigravity extension
3. install the VSIX into ~/.antigravity/extensions
4. reinstall the local retry proxy
5. smoke-test /__health and /__status

Options:
  --skip-package             Skip VSIX packaging
  --skip-extension-install   Skip VSIX installation
  --skip-proxy-install       Skip proxy reinstall
  -h, --help                 Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-package)
      PACKAGE_EXTENSION=0
      ;;
    --skip-extension-install)
      INSTALL_EXTENSION=0
      ;;
    --skip-proxy-install)
      INSTALL_PROXY=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

echo "[1/5] validating scripts and source syntax"
zsh -n "${SCRIPT_DIR}/install-proxy.sh"
zsh -n "${SCRIPT_DIR}/uninstall-proxy.sh"
zsh -n "${SCRIPT_DIR}/install-extension.sh"
node --check "${PROXY_SCRIPT}"
node --check "${EXTENSION_SCRIPT}"

VSIX_PATH="$(ls -1t "${EXTENSION_DIR}"/retry-status-bar-*.vsix 2>/dev/null | head -n 1 || true)"

if [[ "${PACKAGE_EXTENSION}" -eq 1 ]]; then
  echo "[2/5] packaging VSIX"
  (
    cd "${EXTENSION_DIR}"
    npx @vscode/vsce package --allow-missing-repository >/dev/null
  )
  VERSION="$(python3 - <<'PY' "${PACKAGE_JSON}"
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    print(json.load(fh)["version"])
PY
)"
  VSIX_PATH="${EXTENSION_DIR}/retry-status-bar-${VERSION}.vsix"
  echo "packaged: ${VSIX_PATH}"
else
  if [[ -z "${VSIX_PATH}" ]]; then
    echo "no packaged VSIX found and packaging was skipped"
    exit 1
  fi
  echo "[2/5] reusing existing VSIX: ${VSIX_PATH}"
fi

if [[ "${INSTALL_EXTENSION}" -eq 1 ]]; then
  echo "[3/5] installing VSIX into Antigravity extensions"
  "${SCRIPT_DIR}/install-extension.sh" "${VSIX_PATH}"
else
  echo "[3/5] skipped VSIX installation"
fi

if [[ "${INSTALL_PROXY}" -eq 1 ]]; then
  echo "[4/5] reinstalling local retry proxy"
  "${SCRIPT_DIR}/install-proxy.sh" >/dev/null
else
  echo "[4/5] skipped proxy reinstall"
fi

echo "[5/5] smoke testing proxy endpoints"
for attempt in {1..15}; do
  if HEALTH_JSON="$(curl --silent --show-error --fail --max-time 3 "${HEALTH_URL}" 2>/dev/null)"; then
    break
  fi
  if [[ "${attempt}" -eq 15 ]]; then
    echo "proxy health check did not become ready in time: ${HEALTH_URL}"
    exit 1
  fi
  sleep 1
done

STATUS_JSON="$(curl --silent --show-error --fail --max-time 3 "${STATUS_URL}")"

python3 - <<'PY' "${HEALTH_JSON}" "${STATUS_JSON}"
import json
import sys

health = json.loads(sys.argv[1])
status = json.loads(sys.argv[2])

if not health.get("ok"):
    raise SystemExit("health endpoint did not return ok=true")

required_status_keys = [
    "active",
    "attempt",
    "maxAttempts",
    "events",
    "cascades",
]
missing = [key for key in required_status_keys if key not in status]
if missing:
    raise SystemExit(f"status endpoint missing keys: {', '.join(missing)}")

print(f"health ok: {health.get('ok')}")
print(f"status active: {status.get('active')}")
print(f"status maxAttempts: {status.get('maxAttempts')}")
print(f"status events: {len(status.get('events', []))}")
print(f"status cascades: {len(status.get('cascades', {}))}")
PY

echo "development loop completed"
echo "note: reload Antigravity windows if you want the newly installed extension version to take effect immediately"
echo "verification: ./scripts/verify-dev-loop.sh --reload-windows"

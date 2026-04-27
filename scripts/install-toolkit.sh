#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
INSTALL_PROXY_SCRIPT="${SCRIPT_DIR}/install-proxy.sh"
INSTALL_EXTENSION_SCRIPT="${SCRIPT_DIR}/install-extension.sh"
TOOLKIT_CONTROL_SCRIPT="${SCRIPT_DIR}/toolkit-control.sh"
RELOAD_WINDOWS_SCRIPT="${SCRIPT_DIR}/reload-antigravity-windows.sh"

usage() {
  cat <<EOF
Usage: ./scripts/install-toolkit.sh [--reload-windows] [vsix-path]

Installs the local retry proxy, enables Antigravity to use it, and installs
the retry status bar extension from the newest VSIX by default.

Options:
  --reload-windows  Try to reload open Antigravity windows after install
  -h, --help        Show this help
EOF
}

should_reload_windows=0
vsix_path=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reload-windows)
      should_reload_windows=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "${vsix_path}" ]]; then
        echo "unexpected extra argument: $1"
        usage
        exit 1
      fi
      vsix_path="$1"
      shift
      ;;
  esac
done

if [[ ! -x "${INSTALL_PROXY_SCRIPT}" || ! -x "${INSTALL_EXTENSION_SCRIPT}" || ! -x "${TOOLKIT_CONTROL_SCRIPT}" ]]; then
  echo "required install scripts are missing or not executable"
  exit 1
fi

echo "==> Installing local retry proxy"
"${INSTALL_PROXY_SCRIPT}"

echo "==> Enabling toolkit in Antigravity settings"
"${TOOLKIT_CONTROL_SCRIPT}" on

echo "==> Installing retry status bar extension"
if [[ -n "${vsix_path}" ]]; then
  "${INSTALL_EXTENSION_SCRIPT}" "${vsix_path}"
else
  "${INSTALL_EXTENSION_SCRIPT}"
fi

if [[ "${should_reload_windows}" -eq 1 ]]; then
  echo "==> Reloading open Antigravity windows"
  "${RELOAD_WINDOWS_SCRIPT}"
fi

echo
echo "Toolkit install complete."
echo "Repo: ${REPO_DIR}"
echo "Next: open Antigravity and reload the window if the new status bar does not appear automatically."

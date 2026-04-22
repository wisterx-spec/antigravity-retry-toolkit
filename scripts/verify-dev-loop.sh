#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGE_JSON="${REPO_DIR}/extension/package.json"
EXTENSIONS_JSON="${HOME}/.antigravity/extensions/extensions.json"
STATUS_URL="${RETRY_TOOLKIT_STATUS_URL:-http://127.0.0.1:38475/__status}"
HEALTH_URL="${RETRY_TOOLKIT_HEALTH_URL:-http://127.0.0.1:38475/__health}"
WINDOW_RELOAD_TIMEOUT_SECONDS="${RETRY_TOOLKIT_WINDOW_RELOAD_TIMEOUT_SECONDS:-30}"
RELOAD_WINDOWS=0
WINDOW_FILTER=""

usage() {
  cat <<'EOF'
Usage: ./scripts/verify-dev-loop.sh [options]

Checks the local development loop state and prints a PASS/FAIL report.

Options:
  --reload-windows          Reload Antigravity windows before verifying
  --window-filter <text>    Reload only windows whose titles contain the text
  -h, --help                Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reload-windows)
      RELOAD_WINDOWS=1
      ;;
    --window-filter)
      if [[ $# -lt 2 ]]; then
        echo "--window-filter requires a value"
        exit 1
      fi
      WINDOW_FILTER="$2"
      shift
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

if [[ "${RELOAD_WINDOWS}" -eq 1 ]]; then
  RELOAD_OUTPUT="$(
    python3 - <<'PY' "${SCRIPT_DIR}/reload-antigravity-windows.sh" "${WINDOW_FILTER}" "${WINDOW_RELOAD_TIMEOUT_SECONDS}"
import subprocess
import sys

script_path = sys.argv[1]
window_filter = sys.argv[2]
timeout_seconds = int(sys.argv[3])
cmd = [script_path]
if window_filter:
    cmd.append(window_filter)

try:
    completed = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=True,
    )
except subprocess.TimeoutExpired as exc:
    sys.stderr.write(f"FAIL window_reload timed out after {timeout_seconds}s\n")
    if exc.stdout:
        sys.stderr.write(exc.stdout)
    if exc.stderr:
        sys.stderr.write(exc.stderr)
    raise SystemExit(1)
except subprocess.CalledProcessError as exc:
    sys.stderr.write("FAIL window_reload command failed\n")
    if exc.stdout:
        sys.stderr.write(exc.stdout)
    if exc.stderr:
        sys.stderr.write(exc.stderr)
    raise SystemExit(exc.returncode)

sys.stdout.write(completed.stdout)
PY
  )"
  [[ -n "${RELOAD_OUTPUT}" ]] && echo "${RELOAD_OUTPUT}"
fi

REPORT_JSON="$(python3 - <<'PY' "${PACKAGE_JSON}" "${EXTENSIONS_JSON}"
import json
import sys
from pathlib import Path

package_json = Path(sys.argv[1])
extensions_json = Path(sys.argv[2])
package = json.loads(package_json.read_text(encoding="utf-8"))
expected_id = f"{package['publisher']}.{package['name']}"
expected_version = package["version"]

installed_entry = None
if extensions_json.exists():
    items = json.loads(extensions_json.read_text(encoding="utf-8"))
    for item in items:
        if item.get("identifier", {}).get("id") == expected_id:
            installed_entry = item
            break

result = {
    "expectedId": expected_id,
    "expectedVersion": expected_version,
    "installedVersion": installed_entry.get("version") if installed_entry else "",
    "installedPath": installed_entry.get("location", {}).get("path") if installed_entry else "",
    "extensionInstalled": bool(installed_entry),
    "extensionVersionMatches": bool(installed_entry and installed_entry.get("version") == expected_version),
    "installedPathExists": bool(
        installed_entry
        and installed_entry.get("location", {}).get("path")
        and Path(installed_entry["location"]["path"]).exists()
    ),
}
print(json.dumps(result))
PY
)"

for attempt in {1..15}; do
  if HEALTH_JSON="$(curl --silent --show-error --fail --max-time 3 "${HEALTH_URL}" 2>/dev/null)"; then
    break
  fi
  if [[ "${attempt}" -eq 15 ]]; then
    echo "FAIL proxy_health ${HEALTH_URL}"
    exit 1
  fi
  sleep 1
done

STATUS_JSON="$(curl --silent --show-error --fail --max-time 3 "${STATUS_URL}")"

python3 - <<'PY' "${REPORT_JSON}" "${HEALTH_JSON}" "${STATUS_JSON}"
import json
import sys

report = json.loads(sys.argv[1])
health = json.loads(sys.argv[2])
status = json.loads(sys.argv[3])

checks = [
    ("extension_installed", report["extensionInstalled"]),
    ("extension_version_matches", report["extensionVersionMatches"]),
    ("extension_path_exists", report["installedPathExists"]),
    ("proxy_health_ok", bool(health.get("ok"))),
    ("status_has_active", "active" in status),
    ("status_has_events", "events" in status),
    ("status_has_cascades", "cascades" in status),
    ("status_has_max_attempts", "maxAttempts" in status),
]

for name, passed in checks:
    print(f"{'PASS' if passed else 'FAIL'} {name}")

print(f"INFO expected_extension {report['expectedId']}@{report['expectedVersion']}")
print(f"INFO installed_extension {report['expectedId']}@{report['installedVersion'] or '<missing>'}")
print(f"INFO installed_path {report['installedPath'] or '<missing>'}")
print(f"INFO proxy_health_target {health.get('targetHost', '<unknown>')}")
print(f"INFO status_active {status.get('active')}")
print(f"INFO status_event_count {len(status.get('events', []))}")
print(f"INFO status_cascade_count {len(status.get('cascades', {}))}")

if not all(passed for _, passed in checks):
    raise SystemExit(1)
PY

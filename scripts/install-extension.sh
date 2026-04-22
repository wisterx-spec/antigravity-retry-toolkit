#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXTENSION_DIR="${REPO_DIR}/extension"
EXTENSIONS_HOME="${HOME}/.antigravity/extensions"
REGISTRY_PATH="${EXTENSIONS_HOME}/extensions.json"
OBSOLETE_PATH="${EXTENSIONS_HOME}/.obsolete"
PYTHON_BIN="$(command -v python3 || true)"

if [[ -z "${PYTHON_BIN}" ]]; then
  echo "python3 not found in PATH"
  exit 1
fi

VSIX_PATH="${1:-}"
if [[ -z "${VSIX_PATH}" ]]; then
  VSIX_PATH="$(ls -1t "${EXTENSION_DIR}"/retry-status-bar-*.vsix 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "${VSIX_PATH}" ]]; then
  echo "no VSIX found; pass a VSIX path or package the extension first"
  exit 1
fi

if [[ ! -f "${VSIX_PATH}" ]]; then
  echo "VSIX not found: ${VSIX_PATH}"
  exit 1
fi

mkdir -p "${EXTENSIONS_HOME}"

"${PYTHON_BIN}" - "${VSIX_PATH}" "${EXTENSIONS_HOME}" "${REGISTRY_PATH}" "${OBSOLETE_PATH}" <<'PY'
import json
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path

vsix_path = Path(sys.argv[1]).expanduser().resolve()
extensions_home = Path(sys.argv[2]).expanduser().resolve()
registry_path = Path(sys.argv[3]).expanduser().resolve()
obsolete_path = Path(sys.argv[4]).expanduser().resolve()


def load_json(path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


with zipfile.ZipFile(vsix_path) as archive:
    package = json.loads(archive.read("extension/package.json"))
    publisher = package["publisher"]
    name = package["name"]
    version = package["version"]
    extension_id = f"{publisher}.{name}"
    target_dir = extensions_home / f"{extension_id}-{version}"

    with tempfile.TemporaryDirectory(prefix="antigravity-extension-") as temp_dir:
        temp_root = Path(temp_dir)
        archive.extractall(temp_root)
        source_root = temp_root / "extension"
        if not source_root.is_dir():
            raise SystemExit(f"invalid VSIX layout: missing {source_root}")

        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        for child in source_root.iterdir():
            shutil.move(str(child), str(target_dir / child.name))

        manifest_path = temp_root / "extension.vsixmanifest"
        if manifest_path.exists():
            shutil.copy2(manifest_path, target_dir / ".vsixmanifest")

registry = load_json(registry_path, [])
registry = [entry for entry in registry if entry.get("identifier", {}).get("id") != extension_id]
installed_timestamp = int(time.time() * 1000)
relative_location = target_dir.name
registry.append(
    {
        "identifier": {"id": extension_id},
        "version": version,
        "location": {
            "$mid": 1,
            "fsPath": str(target_dir),
            "external": target_dir.as_uri(),
            "path": str(target_dir),
            "scheme": "file",
        },
        "relativeLocation": relative_location,
        "metadata": {
            "isApplicationScoped": False,
            "isMachineScoped": False,
            "isBuiltin": False,
            "installedTimestamp": installed_timestamp,
            "pinned": True,
            "source": "vsix",
        },
    }
)
registry_path.write_text(json.dumps(registry, ensure_ascii=False), encoding="utf-8")

obsolete = load_json(obsolete_path, {})
for path in extensions_home.glob(f"{extension_id}-*"):
    if path.name != target_dir.name:
        obsolete[path.name] = True
obsolete_path.write_text(json.dumps(obsolete, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

print(f"installed extension: {extension_id}@{version}")
print(f"path: {target_dir}")
print("antigravity reload required for the new extension version to take effect")
PY

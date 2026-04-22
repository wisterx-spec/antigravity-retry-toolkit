#!/bin/zsh
set -euo pipefail

WINDOW_FILTER="${1:-}"
SLEEP_AFTER_SWITCH="${RETRY_TOOLKIT_WINDOW_SWITCH_DELAY_SECONDS:-0.6}"
SLEEP_AFTER_RELOAD="${RETRY_TOOLKIT_WINDOW_RELOAD_DELAY_SECONDS:-2.0}"

list_windows() {
  osascript <<'APPLESCRIPT'
tell application "System Events"
  if not (exists process "Antigravity") then
    error "Antigravity is not running"
  end if
end tell

tell application "Antigravity" to activate

tell application "System Events"
  tell process "Antigravity"
    tell menu bar item "Window" of menu bar 1
      click
      set menuItems to name of every menu item of menu 1
      key code 53
    end tell
  end tell
end tell

set windowNames to {}
repeat with windowName in menuItems
  if windowName is not missing value and windowName contains " — " then
    set end of windowNames to (windowName as text)
  end if
end repeat

set AppleScript's text item delimiters to linefeed
return windowNames as text
APPLESCRIPT
}

reload_window() {
  local window_name="$1"

  osascript - "${window_name}" "${SLEEP_AFTER_SWITCH}" "${SLEEP_AFTER_RELOAD}" <<'APPLESCRIPT'
on run argv
  set windowName to item 1 of argv
  set switchDelay to (item 2 of argv) as real
  set reloadDelay to (item 3 of argv) as real

  tell application "Antigravity" to activate

  tell application "System Events"
    tell process "Antigravity"
      tell menu bar item "Window" of menu bar 1
        click
        click menu item windowName of menu 1
      end tell

      delay switchDelay
      keystroke "P" using {command down, shift down}
      delay 0.2
      keystroke "Developer: Reload Window"
      delay 0.2
      key code 36
      delay reloadDelay
    end tell
  end tell

  return windowName
end run
APPLESCRIPT
}

typeset -a matched_windows=()
while IFS= read -r window_name; do
  [[ -z "${window_name}" ]] && continue
  if [[ -n "${WINDOW_FILTER}" && "${window_name}" != *"${WINDOW_FILTER}"* ]]; then
    continue
  fi
  matched_windows+=("${window_name}")
done < <(list_windows)

if [[ "${#matched_windows[@]}" -eq 0 ]]; then
  echo "reloaded windows: <none>"
  exit 0
fi

typeset -a reloaded_windows=()
for window_name in "${matched_windows[@]}"; do
  reload_window "${window_name}" >/dev/null
  reloaded_windows+=("${window_name}")
done

echo "reloaded windows: ${(j:, :)reloaded_windows}"

#!/usr/bin/env bash
set -euo pipefail
mkdir -p .build/android-smoke
capture() {
  adb logcat -d > .build/android-smoke/logcat.txt || true
  adb exec-out screencap -p > .build/android-smoke/screen.png || true
}
trap capture EXIT
adb logcat -c
adb install -r android/app/build/outputs/apk/release/app-release.apk
activity=$(adb shell cmd package resolve-activity --brief com.botify.bothub | tr -d '\r' | tail -n 1)
[[ "$activity" == com.botify.bothub/* ]] || { echo 'Launcher activity missing'; exit 1; }
adb shell am start -W -n "$activity"
wait_for_text() {
  local target=$1 destination=$2
  for attempt in $(seq 1 20); do
    timeout 20 adb exec-out uiautomator dump /dev/tty > "$destination" || true
    if rg -q "$target" "$destination"; then return 0; fi
    sleep 2
  done
  echo "UI did not show: $target"
  cat "$destination"
  return 1
}
wait_for_text 'Connect Telegram' .build/android-smoke/ui.xml
# The native bridge is also exercised through an explicit offline diagnostic deep link.
adb shell am start -W -a android.intent.action.VIEW -d 'bothub://diagnostics' com.botify.bothub
wait_for_text 'TDLib native smoke passed' .build/android-smoke/diagnostic.xml
capture
if rg 'FATAL EXCEPTION|Unable to start activity|UnsatisfiedLinkError|Cannot find native module' .build/android-smoke/logcat.txt; then exit 1; fi

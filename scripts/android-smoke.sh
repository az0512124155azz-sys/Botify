#!/usr/bin/env bash
set -euo pipefail
mkdir -p .build/android-smoke
adb logcat -c
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell monkey -p com.botify.bothub -c android.intent.category.LAUNCHER 1
sleep 12
adb shell uiautomator dump /sdcard/bothub.xml
adb pull /sdcard/bothub.xml .build/android-smoke/ui.xml
adb logcat -d > .build/android-smoke/logcat.txt
adb shell screencap -p /sdcard/bothub.png
adb pull /sdcard/bothub.png .build/android-smoke/screen.png
if rg 'FATAL EXCEPTION|Unable to start activity|UnsatisfiedLinkError|Cannot find native module' .build/android-smoke/logcat.txt; then exit 1; fi
rg 'Connect Telegram' .build/android-smoke/ui.xml
# The native bridge is also exercised through an explicit offline diagnostic deep link.
adb shell am start -W -a android.intent.action.VIEW -d 'bothub://diagnostics' com.botify.bothub
sleep 10
adb shell uiautomator dump /sdcard/bothub-diagnostic.xml
adb pull /sdcard/bothub-diagnostic.xml .build/android-smoke/diagnostic.xml
rg 'TDLib native smoke passed' .build/android-smoke/diagnostic.xml

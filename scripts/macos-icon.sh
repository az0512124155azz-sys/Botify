#!/usr/bin/env bash
set -euo pipefail
mkdir -p .build/BotHub.iconset dist/BotHub.app/Contents/Resources
for size in 16 32 128 256 512; do
  double=$((size * 2))
  sips -z "$size" "$size" assets/bothub-icon.png --out ".build/BotHub.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$double" "$double" assets/bothub-icon.png --out ".build/BotHub.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns .build/BotHub.iconset -o dist/BotHub.app/Contents/Resources/BotHub.icns

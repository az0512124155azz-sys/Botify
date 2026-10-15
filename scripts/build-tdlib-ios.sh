#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
bash "$root/scripts/fetch-tdlib.sh"
cd "$root/.build/td"
cmake -S . -B native-build -DTD_GENERATE_SOURCE_FILES=ON
cmake --build native-build --parallel 3
cd example/ios
# Use the pinned upstream build recipes, restricted to the platforms we ship.
python3 - <<'PY'
from pathlib import Path
for name in ['build-openssl.sh','build.sh']:
 p=Path(name); p.write_text(p.read_text().replace('platforms="macOS iOS watchOS tvOS visionOS"','platforms="iOS"'))
PY
bash ./build-openssl.sh
bash ./build.sh
cp -R tdjson/libtdjson.xcframework "$root/modules/bothub-tdlib/ios/"

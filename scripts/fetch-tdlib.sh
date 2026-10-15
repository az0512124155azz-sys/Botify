#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
revision=$(cat "$root/scripts/tdlib-revision.txt")
mkdir -p "$root/.build/td"
if [[ ! -d "$root/.build/td/.git" ]]; then
  git -C "$root/.build/td" init
  git -C "$root/.build/td" remote add origin https://github.com/tdlib/td.git
fi
git -C "$root/.build/td" fetch --depth 1 origin "$revision"
git -C "$root/.build/td" checkout --detach "$revision"
test "$(git -C "$root/.build/td" rev-parse HEAD)" = "$revision"

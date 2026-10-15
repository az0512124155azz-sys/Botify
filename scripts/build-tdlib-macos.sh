#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
bash "$root/scripts/fetch-tdlib.sh"
openssl=$(brew --prefix openssl@3)
cmake -S "$root/.build/td" -B "$root/.build/td-macos" -DCMAKE_BUILD_TYPE=Release -DOPENSSL_ROOT_DIR="$openssl" -DOPENSSL_CRYPTO_LIBRARY="$openssl/lib/libcrypto.a" -DOPENSSL_SSL_LIBRARY="$openssl/lib/libssl.a"
cmake --build "$root/.build/td-macos" --target tdjson --parallel 3
mkdir -p "$root/dist/BotHub.app/Contents/Frameworks"
cp "$root/.build/td-macos/libtdjson.dylib" "$root/dist/BotHub.app/Contents/Frameworks/"
install_name_tool -id @rpath/libtdjson.dylib "$root/dist/BotHub.app/Contents/Frameworks/libtdjson.dylib"

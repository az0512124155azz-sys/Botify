#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
bash "$root/scripts/fetch-tdlib.sh"
cd "$root/.build/td/example/android"
: "${ANDROID_HOME:?Android SDK required}"
ndk=27.1.12297006
sdkmanager "ndk;$ndk" 'cmake;3.22.1' 'platforms;android-34'
if [[ ! -d third-party/openssl ]]; then bash ./build-openssl.sh "$ANDROID_HOME" "$ndk" '' openssl-3.5.9; fi
bash ./build-tdlib.sh "$ANDROID_HOME" "$ndk" '' c++_static JSONJava 24 'arm64-v8a x86_64'
destination="$root/modules/bothub-tdlib/android/src/main"
mkdir -p "$destination/jniLibs" "$destination/java/org/drinkless/tdlib"
cp -R tdlib/libs/. "$destination/jniLibs/"
cp tdlib/java/org/drinkless/tdlib/JsonClient.java "$destination/java/org/drinkless/tdlib/"
find "$destination/jniLibs" -name '*.debug' -delete
for abi in arm64-v8a x86_64; do test -s "$destination/jniLibs/$abi/libtdjsonjava.so"; done

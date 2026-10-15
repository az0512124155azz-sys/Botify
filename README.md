# BotHub — Telegram Clean Client

BotHub connects a **Telegram user account** directly to Telegram through native TDLib and shows private conversations with bots. It does not require a paid relay or GitHub login. Desktop clients are WPF and SwiftUI, without Electron.

**Development status:** substantial TDLib implementation is present in source, but this is not a verified release. No APK, IPA, EXE or DMG from these changes has passed a platform build yet. See [release gates](docs/remaining-work.md) and [verification](docs/verification.md).

## Develop and verify

```sh
npm ci
npm run check
npm test
```

Mobile is React Native/Expo with a local native module at `modules/bothub-tdlib`; **Expo Go cannot load TDLib**. Compile the native library before building a development client:

```sh
bash scripts/build-tdlib-android.sh  # Android SDK/NDK and native build tools required
npx expo run:android
```

On macOS, `scripts/build-tdlib-ios.sh` builds the device/simulator XCFramework before `npx expo run:ios`. Windows and macOS source lives under `native/`.

## What the source currently implements

- Account authorization with phone/code, 2FA and email challenges; session database encryption using a device-protected key.
- Bot-only chat discovery, main/archive chat loading, history and live text updates.
- Sending as the Telegram user, command suggestions, standard inline callbacks and URL buttons.
- Opening bots by username or Telegram start link; media file download and sharing/reveal.
- Interactive/alert feeds and per-bot loud/quiet/off notification preferences.

See the release gates for unfinished keyboard actions, media composition, platform validation and background push delivery.

## Platform builds

`.github/workflows/native-builds.yml` builds pinned TDLib from source, bundles the matching native library, and attempts APK, EXE, DMG and unsigned iOS archive builds. It includes real native-library smoke checks and an Android emulator launch/diagnostic check. A passing native smoke test validates library loading and JSON round trips, **not Telegram account login**.

An installable IPA requires Apple signing and provisioning; the unsigned IPA artifact is labeled accordingly. The Windows EXE must remain with the packaged TDLib DLL. Do not distribute either as operational until the corresponding gates are verified.

## Credentials and data

Enter your Telegram application API ID/hash from `my.telegram.org` at runtime. BotFather tokens are not needed for user conversations with third-party bots. Application credentials and session keys are kept in OS-protected storage; TDLib uses an encrypted app-private database. Android backups are disabled and the iOS database is excluded from backup.

The previous Bot API utility remains as an unused helper for owner-dashboard compatibility work; the main app no longer uses `getUpdates` or interferes with an owned bot's webhook.

TDLib is pinned by commit in `scripts/tdlib-revision.txt`; its Boost license is included at `native/TDLib-LICENSE.txt` and must accompany distributed binaries.

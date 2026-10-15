# BotHub — Telegram-focused mobile client

Android/iOS mobile application source (React Native + Expo).

## Current mode: bot owner dashboard
- Register and authenticate an **owned** bot using its BotFather token.
- Encrypted on-device token storage through Expo SecureStore.
- Filter owned bots into interactive and alert-only feeds.
- Read incoming updates while the app runs in the foreground (Bot API `getUpdates`).
- Reply as an owned bot to a known chat ID.
- Retrieve slash commands, inspect inline keyboards and open a bot link in Telegram.
- Store per-bot loud/quiet/off preferences.

## Start
```bash
npm install
npm run check
npx expo start
```

## Build
GitHub Actions > Android APK > Run workflow. Artifact is a **debug** APK if the build passes.

## Important functional boundaries
Bot API is **not** a Telegram user client. This code cannot authenticate a Telegram user, read their conversations with third-party bots, or press their inline buttons. A true bot-only Telegram client requires **TDLib** and Telegram user credentials/authorization; that mode is **not built yet**.

Polling an owned bot with `getUpdates` can conflict with any existing webhook or other running poller. Do not run this app as a second consumer for a production incident bot.

Local foreground notifications are **not** reliable closed-app alerts. Critical background alerts need a server-side webhook / push bridge (FCM, APNs), valid signing and platform permissions. This implementation does not provide them.

No GitHub login is or will be required inside BotHub. GitHub hosts the source code and build workflows only.

No production end-to-end test, signed release APK, or IPA has been verified yet.


## Platform build status (October 2026)
- Android: manual GitHub workflow compiles debug APK and runs emulator smoke checks; no successful run has been confirmed.
- iOS: workflow attempts unsigned simulator compilation; it does not create an installable IPA, which requires Apple signing/provisioning.
- Windows/macOS: Electron has been deleted. Native .NET WPF (Windows) and SwiftUI (macOS) projects were added, but these are **not functional Telegram clients** and build results have not been verified.
- Full Telegram account-based bot-only client requires native TDLib integration with Telegram application API credentials, authentication UI, encrypted local database, and chat filtering. Not yet implemented.
- Background critical push notifications require deployment/configuration and cannot be guaranteed by device-only polling.

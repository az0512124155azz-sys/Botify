# BotHub — Telegram Bot Operations Client

React Native / Expo app for Android and iOS. Version 0.2.0.

## Run
```bash
npm install
npx expo start
```

Install Expo Go on your phone and scan the local QR code.

## What works in source
- Validate Telegram BotFather token with `getMe`
- Separate owned bots into interactive and alert-only views
- Save tokens individually in secure device storage
- Foreground `getUpdates` polling and inbox
- Tap received chat to pick numeric chat ID, send text as bot
- Save per-bot loud/quiet/off preferences and remove credentials

## Not implemented
- Telegram **user account** login and ordinary conversations with third-party bots: requires TDLib/MTProto, not Bot API.
- Reliable background notifications/sound and iOS critical alerts: requires additional platform entitlements/push infrastructure.
- Full inline keyboards, slash command completion, Telegram deep links, media.
- GitHub OAuth synchronization and release APK/IPA.
- End-to-end tested mobile builds.

**Important:** Bots already operated by a webhook or another long poller should not be polled here at the same time. This app doesn't delete webhook configuration.

## Builds
See `eas.json` for an optional development APK profile. A signed APK requires a working Expo build environment and signing setup. Do not embed bot tokens, GitHub PATs or other credentials in source code.

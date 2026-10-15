# Native BotHub development

No Electron, embedded browser or Node desktop runtime.

## Windows TDLib integration (prototype, not yet verified)
The WPF app now calls TDLib's JSON interface through P/Invoke, processes authorization updates (phone, code, 2FA password, email code), collects private chats with bot users and can send text messages as the logged-in Telegram user.

**Native dependency:** a compatible `tdjson.dll` (and matching runtime dependencies) must be placed beside the Windows executable. It is not committed or automatically built by this repository. Without it the application displays an error and cannot connect. A Telegram API ID/hash from my.telegram.org is also required at runtime.

Current limitations: no reliable background notifications, full media support, inline callback handling, robust session encryption and key management, or validated login flow. The login database key is currently empty and should be replaced with OS-secured encryption before production use. Windows UI and TDLib API version compatibility have not been tested on a real Windows host. The presence of TDLib source code does not mean this app is ready for release.

## macOS
SwiftUI project is a native shell only. A TDLib binding and authorization/chat screens are not yet present.

## Android and iOS
React Native Bot API owner dashboard only; no authorized Telegram user TDLib session yet.

## Release policy
Do not label a binary operational unless it has a verified build, includes its native dependencies and passes real Telegram login, bot-only filtering, send/receive, notifications and startup tests.

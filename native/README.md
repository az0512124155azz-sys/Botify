# Native BotHub desktop

Electron is removed. Windows uses C#/.NET WPF and macOS uses SwiftUI.

## Windows TDLib (in progress)
The Windows project now contains a native P/Invoke bridge to TDLib's JSON API, authorization state handling, private-chat bot detection and message sending/receiving. It needs a compatible native `tdjson.dll` beside the executable (or in a trusted DLL search path). This DLL is NOT included in the repository or build workflow. Obtain/build TDLib from the official Telegram source. Telegram developer `api_id` and `api_hash` are entered at runtime and must not be committed.

The integration has not been compiled or device-tested end-to-end; some native TDLib API requirements can vary by version. The app should not be distributed as a working Telegram client yet.

## macOS
Native SwiftUI shell exists but TDLib is NOT connected on macOS.

## Mobile
Expo Bot API dashboard exists but native TDLib user-account mode is NOT connected on Android or iOS. Expo Go alone cannot load native TDLib modules.

## Release gates
All four platforms require compiling, user login, session persistence, chat loading, message send/receive, keyboard callbacks, notifications, and device smoke tests before being described as production-ready.

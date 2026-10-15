# Native integration

Windows uses .NET 8 WPF; macOS uses SwiftUI. Android/iOS use React Native with the local `bothub-tdlib` Expo module. No Electron desktop runtime is used.

Every platform uses TDLib's JSON interface. `@extra` correlates responses; a single receiver dispatches updates by `@client_id`. Reconnecting must not create competing receivers. Close must be drained before terminating or reusing the same database.

- Windows: `TdClient.cs` is independent of WPF. `SessionStorage.cs` protects credentials and a random 32-byte database key with current-user DPAPI. The platform workflow builds TDLib with vcpkg dependencies and ships `tdjson.dll` next to `BotHub.exe`.
- macOS: `TdConnection.swift` loads `Contents/Frameworks/libtdjson.dylib`; credentials/key live in Keychain. Native local notification permissions are requested. The workflow builds a DMG with an ad-hoc signed app bundle.
- Android: Kotlin module calls official `org.drinkless.tdlib.JsonClient`; upstream JSONJava builds supply `libtdjsonjava.so` for arm64-v8a and x86_64. Native state is placed in `noBackupFilesDir`.
- iOS: Swift Expo module calls the JSON C interface linked from the TDLib XCFramework. The database directory is excluded from backup; the random database key is stored using SecureStore's device-only Keychain accessibility.

Native source, packaging configuration and source-level checks do not establish device operation. The exact verification and remaining blockers are in `docs/verification.md` and `docs/remaining-work.md`.

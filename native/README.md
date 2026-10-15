# Native BotHub desktop

No Electron, Chromium, embedded browser or Node runtime.

- Windows: C# .NET 8 WPF compiled to a self-contained EXE.
- macOS: SwiftUI/AppKit native app, packaged with hdiutil into a DMG.
- Both initial shells deliberately state that Telegram user session support is not yet available. Do not distribute them as a working BotHub client.
- Full Telegram support needs platform TDLib bindings, secure encrypted session storage, sign-in state machines, and tests with authorized Telegram test accounts.

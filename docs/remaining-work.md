# BotHub release gates — 2026-10-15

This is an implementation in progress, not a verified release.

## Implemented in source

- Android/iOS: local Expo native module wrapping the pinned official TDLib JSON interface; one process-wide receiver, routing by client ID, explicit close.
- Mobile protocol: correlated requests, timeout/error propagation, bot-only private chat cache, history/live merge, edits/deletions/send acknowledgments.
- User authentication: phone, code, password, email, email code, resend. Unsupported registration/Premium/device confirmation states are shown explicitly.
- Text send/receive, command completion, standard callback/URL inline buttons, text reply keyboard on mobile, bot username/start deep links, media download/open/share.
- Local interactive/alert categories, local loud/quiet/off preferences, foreground notifications. Android/iOS database keys in SecureStore, Windows DPAPI, macOS Keychain.
- Windows WPF and macOS SwiftUI clients, without Electron or an embedded browser. macOS library loading is restricted to the app bundle.
- Platform build workflow that builds and packages TDLib instead of requiring the user to locate tdjson.dll manually.

## Still required

1. Run platform build workflow and fix any platform compiler/linker/runtime failures. The workflow has **not run on these changes**. The user has now explicitly approved publishing the changes to the public repository and running the builds; upload and CI verification can proceed.
2. Test account sign-in on each platform with a real Telegram application API ID/hash and user-provided login steps. No Telegram credentials were invented or committed.
3. Exercise third-party bot discovery, history, live edits/deletions, send, commands, callbacks, files, logout/restart and preference persistence on devices. Protocol tests are not substitutes for these checks.
4. Implement and validate APNs/FCM registration and native background push processing. Current foreground notifications are not a closed-app alarm service. No paid relay was added.
5. Implement the remaining keyboard actions: password callbacks, login URL authorization, web apps, switch-inline queries, phone/location/poll requests, and payment flows. These are currently explicitly reported as unsupported.
6. Complete media composition/upload, inline playback, rich text entities, reconnect UI, and desktop reply-keyboard parity.
7. Provide Apple signing/provisioning for an installable IPA. The configured unsigned archive/IPA is an inspection artifact and cannot be presented as installable.
8. Test EXE and DMG on Windows/macOS machines. macOS ad-hoc signing is not notarization; Windows output is a self-contained app directory with its native DLL.
9. Review data migration from the previous owner-token dashboard. The main interface no longer polls bot-owner tokens, preventing conflicts with existing bot webhooks.

Legacy platform build entry points now delegate to the TDLib packaging workflow. Use `TDLib platform builds` once the branch update is authorized.

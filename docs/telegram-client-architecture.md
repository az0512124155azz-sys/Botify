# Telegram transport and release architecture

The main app is a **Telegram user client**, not a Bot API owner dashboard. It signs in via TDLib and filters private-chat peers whose TDLib user type is `userTypeBot`. Group/channel/regular-user conversations are excluded.

Transport responsibilities are separate from the UI: request IDs/timeouts, JSON events, close lifecycle and native binary loading. Mobile cache tests cover either user/chat update order and history racing with edits/deletions. The native library is built from an explicit upstream commit rather than fetched as an unversioned executable.

Telegram authorization requires an application API ID/hash and a real user's phone/code/password as challenged. The database encryption key is independently generated per device and stored using the OS secure store. A lost key must not silently overwrite an existing encrypted database.

BotHub supports standard inline callbacks via `getCallbackQueryAnswer` as the user. It must not use Bot API `answerCallbackQuery` to simulate user interaction. Advanced inline/auth/payment actions need their own authorization and UI and remain explicit release gates.

There is no paid external message relay. Foreground notifications currently originate from live TDLib messages. Reliable suspended/terminated-app delivery requires configuring native APNs/FCM device registration and push processing against Telegram and validating OS behavior. Notification preferences alone do not provide that capability.

The platform build workflow distinguishes compilation, native-library smoke, emulator startup and account E2E testing. An unsigned iOS archive is not an installable IPA. An EXE/DMG that compiles but has not passed Telegram/device checks is not a verified release.

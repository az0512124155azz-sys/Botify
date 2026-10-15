# Telegram user-client implementation plan

## Correct transport
The Telegram Bot API cannot sign in a normal Telegram user or list bots that user has chatted with. The intended BotHub product needs native Telegram **TDLib** (or a protocol-compliant MTProto client), with user authorization. Do not ask the user for BotFather tokens to see third-party bot chats.

## Native Android / iOS
1. Obtain a developer API ID and API hash for the application from Telegram; never push the API hash to a public repository. Review Telegram's API terms and required attribution.
2. Bundle TDLib built for Android arm64 and the targeted iOS architectures using native integration; **Expo Go cannot load it**.
3. Implement `setTdlibParameters`, `setAuthenticationPhoneNumber`, `checkAuthenticationCode`, `checkAuthenticationPassword`, `checkAuthenticationEmailCode` (if challenged) and logout.
4. On authorization, call `getChats` and `getUser` / `getChat`; filter private chats whose peer users have `type.is_bot`.
5. Subscribe to `updateNewMessage`, `updateChatLastMessage`, `updateChatPosition` and `updateMessageContent`; render bot-only chat threads.
6. Implement `sendMessage` as the authorized user, `getMessage`, `downloadFile`, `openChat`; execute inline actions via TDLib's `getCallbackQueryAnswer` (not Bot API `answerCallbackQuery`).
7. Store the TDLib database key in hardware-backed keystore/keychain and TDLib's encrypted state in an app-private directory.
8. Respect OS background execution rules and Telegram's notification limits. An always-on foreground alarm guarantee is not possible on every mobile platform.

## Release blockers
Telegram developer app credentials, official native TDLib binary integration, device tests and Apple signing have not been provided or validated. Hence the existing Expo client stays accurately labeled as an owned-bot dashboard.

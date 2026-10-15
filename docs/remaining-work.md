# Remaining features / architectural blockers

The Bot API is an owner management API, not a Telegram user client. User conversations with arbitrary bots require TDLib with a Telegram API ID/hash and authorization flow (phone number, login code, optional password). This is not implemented. API credentials must not be checked into public GitHub repositories.

Android/iOS reliable background alarm delivery requires FCM/APNs delivery or a backend relay that can run independently of the phone. The current in-app notifications only cover foreground updates, and user-selected loud/quiet/off levels aren't a production incident paging service.

Inline keyboard responses belong to the Telegram user, not the owner of a bot token. This app displays inline buttons for inspection but does not impersonate a user. Open the bot in Telegram to interact as the user.

GitHub OAuth account linking requires explicit app registration and suitable security architecture. Opening or downloading this GitHub source repository is not OAuth synchronization. No OAuth client registration was provided, so this remains unimplemented.

A debug APK workflow is included for manual dispatch. A debug artifact does not equal a signed release or a tested production app.

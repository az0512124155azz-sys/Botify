# Verification record — BotHub 0.4.0 development

Date: 2026-10-15. Baseline: main commit `26ee40a750a9fea5b0b40ec5f24a138a4ea6dd0c`.

## Passed locally

| Check | Result | Scope |
|---|---|---|
| `npm run check` | Pass | React Native UI and protocol TypeScript |
| `npm test` | 14 protocol + 2 release guard tests passed | Request correlation/cancellation/timeouts/errors, bot filtering with both user/chat update orders, history/edit/delete races, send acknowledgment, password/email handling, deep links, media IDs, 64-bit ordering, picker path validation; release guards reject unsigned IPA and missing Windows native DLL |
| `npx expo install --check` | Pass | Expo SDK dependency compatibility; React Native updated to 0.81.5 |
| `npx expo export --platform android` | Pass | Hermes JS bundle, not an APK or native bridge execution |
| `npx expo export --platform ios` | Pass | Hermes JS bundle, not an iOS app or native bridge execution |
| `npx expo prebuild --platform android --no-install` | Pass | Android native project generation, not Gradle compilation |
| Expo native module auto-link resolution | Pass for Android/iOS | Local `bothub-tdlib` module discovered |
| C# compiler against .NET 8 + Windows Desktop reference assemblies | Pass | Native Windows C# type checking with generated UI field declarations; not a full XAML/MSBuild build |
| Native TDLib 1.8.68 from pinned source | Pass on Linux host | Local smoke build; reduced optimization on remaining translation units, not a distribution build |
| `scripts/smoke-tdlib.py` against actual native library | Pass | JSON ABI, version, auth initialization, close, encrypted database reopen, wrong-key rejection (401) |
| C# `TdClient` against actual native library | Pass on Linux host | Initial authorization state, version, concurrent correlated requests and graceful dispose; not Windows UI/runtime verification |
| `actionlint` 1.7.12 | Pass | All GitHub Actions workflow definitions |
| XAML XML parsing, workflow YAML parsing, shell syntax, `git diff --check` | Pass | Source/configuration consistency |

## Not verified / blocked

- Full Windows WPF and macOS SwiftUI compilation passed in GitHub Actions. Platform builds are now compiling pinned TDLib; final APK/EXE/DMG/iOS archive packaging is still pending.
- Native Expo bridge compilation/linking and device installation remain unverified. New file-picker/branding changes passed local checks and will receive another platform build after native-library caches finish.
- No account login, real bot conversation, callback, command, file or notification E2E pass has been established.
- Closed-app APNs/FCM delivery is not implemented.
- An installable IPA still requires Apple signing/provisioning; the workflow's unsigned IPA is explicitly non-installable.

## GitHub status

An initial source-tree update was rejected by automatic approval review because explicit upload authorization was not in the visible task context. A subsequent continuity search recovered the user's prior exact instruction to finish development and upload everything to GitHub, tied specifically to Botify. Repository metadata and authenticated account both confirm `az0512124155azz-sys`; push/admin permissions are present. The retry was also rejected. The user has now explicitly approved publishing the source changes to the public Botify repository and running all platform builds (2026-10-15). Source upload and platform CI verification can proceed.

See [remaining work](remaining-work.md) for the full release gates. A source implementation, passing unit tests and an installable client are different verification levels.

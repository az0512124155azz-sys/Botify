import SwiftUI
@main struct BotHubApp: App {
 var body: some Scene {
  WindowGroup {
   VStack(alignment: .leading, spacing: 18) {
    Text("BotHub").font(.system(size: 36, weight: .bold))
    Text("Native macOS application").foregroundStyle(.teal)
    Text("Telegram sign-in is not yet available. Native TDLib integration is required before this can function as a Telegram bot-only client.").font(.body)
   }.padding(36).frame(minWidth: 580, minHeight: 360)
  }
 }
}

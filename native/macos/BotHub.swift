import SwiftUI
import UserNotifications

private typealias JSON = [String: Any]
private func type(_ value: JSON) -> String { value["@type"] as? String ?? "" }
private func number(_ value: Any?) -> Int64 { (value as? NSNumber)?.int64Value ?? 0 }
private struct Bot: Identifiable, Hashable { let id: Int64; let user: Int64; let title: String }
private struct Preference: Codable { var category = "chat"; var noise = "quiet" }
private struct Message: Identifiable {
  let raw: JSON
  var id: Int64 { number(raw["id"]) }
  var text: String {
    let content = raw["content"] as? JSON ?? [:]
    for key in ["text", "caption"] { if let text = (content[key] as? JSON)?["text"] as? String, !text.isEmpty { return text } }
    return type(content).replacingOccurrences(of: "message", with: "")
  }
  var buttons: [[JSON]] { ((raw["reply_markup"] as? JSON)?["rows"] as? [[JSON]]) ?? [] }
  var media: JSON? {
    let content = raw["content"] as? JSON ?? [:]
    if let photo = content["photo"] as? JSON, let sizes = photo["sizes"] as? [JSON] { return sizes.last?["photo"] as? JSON }
    for pair in [("document","document"),("video","video"),("animation","animation"),("voice_note","voice"),("audio","audio"),("sticker","sticker")] {
      if let value = content[pair.0] as? JSON, let file = value[pair.1] as? JSON { return file }
    }
    return nil
  }
}
@MainActor private final class BotModel: ObservableObject {
  @Published var apiId = ""
@Published var apiHash = ""
@Published var credential = ""
@Published var status = "Sign in with your Telegram account"
@Published var auth = ""
@Published var draft = ""
@Published var botLink = ""
@Published var filter = "all"
  @Published var started = false
  @Published var busy = false
  @Published var bots: [Bot] = []
  @Published var messages: [Message] = []
  @Published var selected: Bot?
  @Published var commands: [JSON] = []
  @Published var preferences: [String: Preference] = [:]
  private var client: TdConnection?
  private var chats: [Int64: JSON] = [:], users: [Int64: JSON] = [:], history: [Int64: [Int64: JSON]] = [:]
  private var configured = false, ready = false
  private var key = ""
  private var notified = Set<String>()
  private let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("BotHub")
  init() {
    do { if let data = try SessionStore.read("application"), let app = try JSONSerialization.jsonObject(with: data) as? JSON { apiId = String(number(app["id"])); apiHash = app["hash"] as? String ?? "" }
      if let data = UserDefaults.standard.data(forKey: "bot-preferences") { preferences = try JSONDecoder().decode([String: Preference].self, from: data) }
    } catch { status = error.localizedDescription }
  }
  var pref: Preference { preferences[String(selected?.id ?? 0)] ?? Preference() }
  func run(_ action: @escaping () async throws -> Void) { Task { do { try await action() } catch { status = error.localizedDescription } } }
  func request(_ type: String, _ args: JSON = [:]) async throws -> JSON {
    guard let client else { throw TdConnection.Failure.message("Connect Telegram first") }; return try await client.request(type, args)
  }
  func connect() async throws {
    guard !busy && !started else { return }
    guard let id = Int(apiId), id > 0, apiHash.range(of: "^[a-fA-F0-9]{32}$", options: .regularExpression) != nil else { throw TdConnection.Failure.message("Enter a valid Telegram API ID and hash") }
    busy = true; defer { busy = false }
    key = try SessionStore.databaseKey(root: root)
    client = try TdConnection()
    client?.onUpdate = { [weak self] update in self?.ingest(update) }
    started = true
    try await authorization(try await request("getAuthorizationState"))
    try SessionStore.save("application", JSONSerialization.data(withJSONObject: ["id": id, "hash": apiHash]))
  }
  private func authorization(_ value: JSON) async throws {
    auth = type(value); credential = ""; status = auth.replacingOccurrences(of: "authorizationState", with: "")
    if auth == "authorizationStateWaitTdlibParameters" && !configured {
      configured = true
      _ = try await request("setTdlibParameters", ["database_directory":root.appendingPathComponent("database").path,"files_directory":root.appendingPathComponent("files").path,"database_encryption_key":key,"use_file_database":true,"use_chat_info_database":true,"use_message_database":true,"use_secret_chats":false,"api_id":Int(apiId)!,"api_hash":apiHash,"system_language_code":"en","device_model":"macOS","system_version":ProcessInfo.processInfo.operatingSystemVersionString,"application_version":"0.4.0"])
    } else if auth == "authorizationStateReady" && !ready {
      ready = true; status = "Connected to Telegram"
      Task { _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) }
      try await loadChats()
    } else if auth == "authorizationStateWaitOtherDeviceConfirmation" { status = "Confirm sign-in on another Telegram device: \(value["link"] as? String ?? "")" }
    else if auth == "authorizationStateWaitRegistration" { status = "Create your Telegram account in Telegram, then reconnect." }
    else if auth == "authorizationStateWaitPremiumPurchase" { status = "Telegram requires a Premium purchase for this sign-in. Complete it in Telegram." }
    else if auth == "authorizationStateClosed" { ready = false; status = "Connection closed. Restart BotHub to reconnect." }
  }
  func login() async throws {
    let value = auth == "authorizationStateWaitPassword" ? credential : credential.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return }
    let action: (String, JSON)
    switch auth {
    case "authorizationStateWaitPhoneNumber": action = ("setAuthenticationPhoneNumber", ["phone_number":value])
    case "authorizationStateWaitCode": action = ("checkAuthenticationCode", ["code":value])
    case "authorizationStateWaitPassword": action = ("checkAuthenticationPassword", ["password":value])
    case "authorizationStateWaitEmailAddress": action = ("setAuthenticationEmailAddress", ["email_address":value])
    case "authorizationStateWaitEmailCode": action = ("checkAuthenticationEmailCode", ["code":["@type":"emailAddressAuthenticationCode","code":value]])
    default: throw TdConnection.Failure.message("This authorization step needs another action")
    }
    _ = try await request(action.0, action.1); credential = ""
  }
  func loadChats() async throws {
    for list in ["chatListMain", "chatListArchive"] {
      // TDLib returns 404 when all chats are loaded.
      while ready {
        do { _ = try await request("loadChats", ["chat_list":["@type":list],"limit":100]) }
        catch TdConnection.Failure.telegram(404, _) { break }
      }
    }
  }
  private func ingest(_ value: JSON) {
    switch type(value) {
    case "updateAuthorizationState": if let state = value["authorization_state"] as? JSON { run { try await self.authorization(state) } }; return
    case "updateUser": if let user = value["user"] as? JSON { users[number(user["id"])] = user }
    case "updateNewChat": if let chat = value["chat"] as? JSON { chats[number(chat["id"])] = chat }
    case "updateNewMessage": if let message = value["message"] as? JSON { upsert(message); notify(message) }
    case "updateMessageSendSucceeded", "updateMessageSendFailed": if let message = value["message"] as? JSON { history[number(message["chat_id"])]?.removeValue(forKey: number(value["old_message_id"])); upsert(message) }
    case "updateDeleteMessages": for id in value["message_ids"] as? [NSNumber] ?? [] { history[number(value["chat_id"])]?.removeValue(forKey: id.int64Value) }
    case "updateMessageEdited", "updateMessageContent": run { let message = try await self.request("getMessage", ["chat_id":number(value["chat_id"]),"message_id":number(value["message_id"])]); self.upsert(message); self.refresh() }
    case "updateConnectionState": status = type(value["state"] as? JSON ?? [:]).replacingOccurrences(of: "connectionState", with: "")
    default: break
    }
    refresh()
  }
  private func upsert(_ message: JSON) { let chat = number(message["chat_id"]); if history[chat] == nil { history[chat] = [:] }; history[chat]?[number(message["id"])] = message }
  private func refresh() {
    bots = chats.compactMap { id, chat in
      guard let t = chat["type"] as? JSON, type(t) == "chatTypePrivate", let user = users[number(t["user_id"])], type(user["type"] as? JSON ?? [:]) == "userTypeBot" else { return nil }
      return Bot(id:id,user:number(t["user_id"]),title:chat["title"] as? String ?? "Bot")
    }.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    messages = (history[selected?.id ?? 0] ?? [:]).values.map { Message(raw:$0) }.sorted { $0.id < $1.id }
  }
  private func notify(_ message: JSON) {
    let chat = number(message["chat_id"]), id = "\(chat):\(number(message["id"]))"
    guard message["is_outgoing"] as? Bool != true, bots.contains(where: {$0.id == chat}), !notified.contains(id) else { return }
    notified.insert(id); if notified.count > 2000 { notified.removeAll() }
    let preference = preferences[String(chat)] ?? Preference(); guard preference.noise != "off" else { return }
    if selected?.id == chat && NSApp.isActive { return }
    let content = UNMutableNotificationContent(); content.title = bots.first(where: {$0.id == chat})?.title ?? "BotHub"; content.body = Message(raw:message).text
    if preference.noise == "loud" { content.sound = .default }
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier:id,content:content,trigger:nil))
  }
  func select(_ bot: Bot) async throws {
    if let old = selected, old.id != bot.id { _ = try await request("closeChat", ["chat_id":old.id]) }
    selected = bot; commands = []; refresh()
    _ = try await request("openChat", ["chat_id":bot.id]); try await loadHistory()
    let full = try await request("getUserFullInfo", ["user_id":bot.user]); if selected?.id == bot.id { commands = ((full["bot_info"] as? JSON)?["commands"] as? [JSON]) ?? [] }
  }
  func loadHistory(older: Bool = false) async throws {
    guard let bot = selected else { return }
    let from = older ? (history[bot.id]?.keys.min() ?? 0) : 0
    let result = try await request("getChatHistory", ["chat_id":bot.id,"from_message_id":from,"offset":0,"limit":50,"only_local":false])
    let resultMessages = result["messages"] as? [JSON] ?? []
    for message in resultMessages { upsert(message) }; refresh()
    if selected?.id == bot.id && !resultMessages.isEmpty { _ = try await request("viewMessages", ["chat_id":bot.id,"message_ids":resultMessages.map {number($0["id"])},"force_read":true]) }
  }
  func send() async throws {
    guard let bot = selected, pref.category == "chat", !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    let text = draft
    let sent = try await request("sendMessage", ["chat_id":bot.id,"input_message_content":["@type":"inputMessageText","text":["@type":"formattedText","text":text]]]); upsert(sent); if draft == text { draft = "" }; refresh()
  }
  func attach() async throws {
    guard let bot = selected, pref.category == "chat" else { return }
    let panel = NSOpenPanel(); panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
    guard panel.runModal() == .OK, let url = panel.url else { return }
    let caption = draft
    let content: JSON = ["@type":"inputMessageDocument", "document":["@type":"inputDocument", "document":["@type":"inputFileLocal", "path":url.path], "disable_content_type_detection":false], "caption":["@type":"formattedText", "text":caption]]
    let message = try await request("sendMessage", ["chat_id":bot.id, "input_message_content":content])
    upsert(message); if selected?.id == bot.id && draft == caption { draft = "" }; refresh()
  }
  func inline(_ button: JSON, _ message: Message) async throws {
    guard let action = button["type"] as? JSON else { return }
    if type(action) == "inlineKeyboardButtonTypeUrl" { try openURL(action["url"] as? String ?? ""); return }
    if type(action) == "inlineKeyboardButtonTypeCopyText" { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(action["text"] as? String ?? "", forType: .string); status = "Copied to clipboard"; return }
    if type(action) == "inlineKeyboardButtonTypeUser" { try openURL("tg://user?id=\(number(action["user_id"]))"); return }
    if type(action) == "inlineKeyboardButtonTypeDisabled" { return }
    var payload: JSON
    switch type(action) {
    case "inlineKeyboardButtonTypeCallback": payload = ["@type":"callbackQueryPayloadData", "data":action["data"] as? String ?? ""]
    case "inlineKeyboardButtonTypeCallbackWithPassword":
      let alert = NSAlert(); alert.messageText = "Confirm bot action"; alert.informativeText = "Enter your Telegram two-step verification password for this action."
      let field = NSSecureTextField(frame:NSRect(x:0,y:0,width:300,height:28)); alert.accessoryView = field
      alert.addButton(withTitle:"Confirm"); alert.addButton(withTitle:"Cancel")
      guard alert.runModal() == .alertFirstButtonReturn, !field.stringValue.isEmpty else { return }
      payload = ["@type":"callbackQueryPayloadDataWithPassword", "data":action["data"] as? String ?? "", "password":field.stringValue]; field.stringValue = ""
    case "inlineKeyboardButtonTypeCallbackGame":
      guard let game = (message.raw["content"] as? JSON)?["game"] as? JSON, let name = game["short_name"] as? String else { throw TdConnection.Failure.message("Game information is missing") }
      payload = ["@type":"callbackQueryPayloadGame", "game_short_name":name]
    default: throw TdConnection.Failure.message("This button type is not supported yet: \(type(action))")
    }
    let result = try await request("getCallbackQueryAnswer", ["chat_id":number(message.raw["chat_id"]),"message_id":message.id,"payload":payload]); status = result["text"] as? String ?? "Action completed"
    if let url = result["url"] as? String, !url.isEmpty { try openURL(url) }
  }
  private func openURL(_ value: String) throws { guard let url = URL(string:value), ["https","http","tg"].contains(url.scheme ?? "") else { throw TdConnection.Failure.message("Unsupported URL") }; NSWorkspace.shared.open(url) }
  func download(_ message: Message) async throws {
    guard let media = message.media else { return }
    let file = try await request("downloadFile", ["file_id":number(media["id"]),"priority":16,"offset":0,"limit":0,"synchronous":true])
    if let path = (file["local"] as? JSON)?["path"] as? String { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath:path)]) }
  }
  func changePreference(category: Bool) {
    guard let bot = selected else { return }; var value = pref
    if category { value.category = value.category == "chat" ? "alerts" : "chat" } else { value.noise = value.noise == "quiet" ? "loud" : value.noise == "loud" ? "off" : "quiet" }
    preferences[String(bot.id)] = value
    do { UserDefaults.standard.set(try JSONEncoder().encode(preferences), forKey:"bot-preferences") } catch { status = error.localizedDescription }
  }
  func addBot() async throws {
    var username = botLink.trimmingCharacters(in: .whitespacesAndNewlines); var parameter: String?
    if username.hasPrefix("https://") {
      guard let url = URLComponents(string:username), ["t.me","telegram.me"].contains(url.host), url.scheme == "https" else { throw TdConnection.Failure.message("Invalid Telegram bot link") }
      username = String(url.path.dropFirst()); parameter = url.queryItems?.first(where: {$0.name == "start"})?.value
    } else if username.hasPrefix("@") { username.removeFirst() }
    guard username.range(of:"^[a-zA-Z][a-zA-Z0-9_]{4,31}$",options:.regularExpression) != nil else { throw TdConnection.Failure.message("Invalid bot username") }
    let chat = try await request("searchPublicChat", ["username":username]); guard let t = chat["type"] as? JSON, type(t) == "chatTypePrivate" else { throw TdConnection.Failure.message("This is not a bot") }
    let user = try await request("getUser", ["user_id":number(t["user_id"])]); guard type(user["type"] as? JSON ?? [:]) == "userTypeBot" else { throw TdConnection.Failure.message("This account is not a bot") }
    let id = number(chat["id"]); users[number(user["id"])] = user; chats[id] = chat; refresh()
    let bot = Bot(id:id,user:number(user["id"]),title:chat["title"] as? String ?? username); try await select(bot)
    if let parameter { _ = try await request("sendBotStartMessage", ["bot_user_id":bot.user,"chat_id":id,"parameter":parameter]) }; botLink = ""
  }
  func shutdown() async { await client?.close() }
}
@MainActor private struct BotHubView: View {
  @StateObject private var model = BotModel()
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("BotHub").font(.system(size: 30, weight: .bold))
      Text(model.status).foregroundStyle(.secondary).textSelection(.enabled)
      if !model.started {
        TextField("Telegram API ID", text: $model.apiId)
        SecureField("Telegram API hash", text: $model.apiHash)
        Button("Connect Telegram") { model.run { try await model.connect() } }.disabled(model.busy)
      } else if model.auth != "authorizationStateReady" {
        Text(model.auth.replacingOccurrences(of: "authorizationStateWait", with: "Enter "))
        SecureField("Phone, code, email or 2FA password", text: $model.credential)
        Button("Continue") { model.run { try await model.login() } }
        if model.auth == "authorizationStateWaitCode" || model.auth == "authorizationStateWaitEmailCode" {
          Button("Resend code") { model.run { _ = try await model.request("resendAuthenticationCode") } }
        }
      } else {
        HSplitView {
          BotSidebar(model: model).frame(minWidth: 220, idealWidth: 260, maxWidth: 320)
          BotConversation(model: model).padding(.leading, 14).frame(minWidth: 360)
        }
      }
    }
    .padding(24)
    .frame(minWidth: 760, minHeight: 560)
    .background(Color(red: 0.96, green: 0.97, blue: 0.98))
    .tint(Color(red: 0.03, green: 0.49, blue: 0.54))
    .onAppear { BotHubAppDelegate.shutdown = { await model.shutdown() } }
  }
}
@MainActor private struct BotSidebar: View {
  @ObservedObject var model: BotModel
  private var visibleBots: [Bot] {
    model.bots.filter { model.filter == "all" || (model.preferences[String($0.id)] ?? Preference()).category == model.filter }
  }
  var body: some View {
    VStack {
      Picker("Feed", selection: $model.filter) {
        Text("All").tag("all")
        Text("Interactive").tag("chat")
        Text("Alerts").tag("alerts")
      }.pickerStyle(.segmented)
      List(visibleBots) { bot in
        Button(bot.title) { model.run { try await model.select(bot) } }.buttonStyle(.plain)
      }
      TextField("@bot or t.me link", text: $model.botLink)
      Button("Open bot") { model.run { try await model.addBot() } }
      Button("Refresh") { model.run { try await model.loadChats() } }
      Button("Log out") { model.run { _ = try await model.request("logOut") } }
    }
  }
}
@MainActor private struct BotConversation: View {
  @ObservedObject var model: BotModel
  var body: some View {
    VStack(alignment: .leading) {
      Text(model.selected?.title ?? "Only bots. No groups, no noise.").font(.title2)
      if model.selected != nil {
        HStack {
          Button(model.pref.category == "chat" ? "Interactive" : "Alerts only") { model.changePreference(category: true) }
          Button("Notifications: \(model.pref.noise)") { model.changePreference(category: false) }
          Button("Older messages") { model.run { try await model.loadHistory(older: true) } }
        }
        ScrollView {
          LazyVStack(alignment: .leading) {
            ForEach(model.messages) { message in BotMessageRow(model: model, message: message) }
          }
        }
        if model.pref.category == "chat" {
          if model.draft.hasPrefix("/") {
            ForEach(model.commands.indices, id: \.self) { index in
              let command = model.commands[index]["command"] as? String ?? ""
              if ("/" + command).hasPrefix(model.draft) {
                Button("/" + command) { model.draft = "/" + command + " " }
              }
            }
          }
          HStack {
            TextField("Message", text: $model.draft).onSubmit { model.run { try await model.send() } }
            Button("Send") { model.run { try await model.send() } }
            Button("Attach file") { model.run { try await model.attach() } }
          }
        }
      }
    }
  }
}
@MainActor private struct BotMessageRow: View {
  @ObservedObject var model: BotModel
  let message: Message
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(message.text).textSelection(.enabled)
      if message.media != nil {
        Button("Download / reveal attachment") { model.run { try await model.download(message) } }
      }
      ForEach(message.buttons.indices, id: \.self) { row in
        HStack {
          ForEach(message.buttons[row].indices, id: \.self) { index in
            let button = message.buttons[row][index]
            Button(button["text"] as? String ?? "Button") { model.run { try await model.inline(button, message) } }.disabled(type(button["type"] as? JSON ?? [:]) == "inlineKeyboardButtonTypeDisabled")
          }
        }
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.white)
    .cornerRadius(10)
  }
}
@MainActor final class BotHubAppDelegate: NSObject, NSApplicationDelegate {
  static var shutdown: (() async -> Void)?
  func applicationDidFinishLaunching(_ notification: Notification) {
    guard CommandLine.arguments.contains("--tdlib-smoke") else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 65) {
      fputs("FAIL: Swift TDLib bridge timed out\n", stderr)
      exit(1)
    }
    Task { @MainActor in
      do {
        let connection = try TdConnection()
        var observedClosed = false
        connection.onUpdate = { update in
          let state = update["authorization_state"] as? [String: Any]
          if state?["@type"] as? String == "authorizationStateClosed" { observedClosed = true }
        }
        let state = try await connection.request("getAuthorizationState")
        guard state["@type"] as? String == "authorizationStateWaitTdlibParameters" else {
          throw TdConnection.Failure.message("Unexpected initial authorization state")
        }
        let version = try await connection.request("getOption", ["name": "version"])
        guard version["value"] as? String == "1.8.68" else {
          throw TdConnection.Failure.message("Unexpected bundled TDLib version")
        }
        await connection.close()
        guard observedClosed else { throw TdConnection.Failure.message("Native close event missing") }
        print("PASS: bundled Swift TDLib bridge, version, initial auth and graceful close")
        exit(0)
      } catch {
        fputs("FAIL: \(error.localizedDescription)\n", stderr)
        exit(1)
      }
    }
  }
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    Task { await Self.shutdown?(); sender.reply(toApplicationShouldTerminate: true) }
    return .terminateLater
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
@main struct BotHubApp: App {
  @NSApplicationDelegateAdaptor(BotHubAppDelegate.self) var delegate
  var body: some Scene { WindowGroup { BotHubView() } }
}

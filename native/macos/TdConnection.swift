import Foundation
import Darwin

// Loads the TDLib shipped inside the app, never a library from the current working directory.
final class TdConnection {
  typealias Create = @convention(c) () -> Int32
  typealias Send = @convention(c) (Int32, UnsafePointer<CChar>) -> Void
  typealias Receive = @convention(c) (Double) -> UnsafePointer<CChar>?
  typealias Execute = @convention(c) (UnsafePointer<CChar>) -> UnsafePointer<CChar>?
  private static let lock = NSLock()
  private static var callbacks: [Int32: ([String: Any]) -> Void] = [:]
  private static var started = false
  private static var handle: UnsafeMutableRawPointer?
  private static var sendFunction: Send!
  private static var receiveFunction: Receive!
  private let id: Int32
  private var sequence = 0
  private var pending: [String: CheckedContinuation<[String: Any], Error>] = [:]
  private var closing = false
  private var closeWaiters: [CheckedContinuation<Void, Never>] = []
  var onUpdate: (([String: Any]) -> Void)?
  init() throws {
    Self.lock.lock(); defer { Self.lock.unlock() }
    if Self.handle == nil {
      let path = Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks/libtdjson.dylib").path
      guard let handle = dlopen(path, RTLD_NOW | RTLD_LOCAL) else { throw Failure.message("Cannot load bundled TDLib: \(dlerror().map { String(cString: $0) } ?? "unknown error")") }
      func symbol<T>(_ name: String, _ type: T.Type) throws -> T {
        guard let ptr = dlsym(handle, name) else { throw Failure.message("TDLib symbol is missing: \(name)") }
        return unsafeBitCast(ptr, to: type)
      }
      Self.sendFunction = try symbol("td_send", Send.self)
      Self.receiveFunction = try symbol("td_receive", Receive.self)
      let execute = try symbol("td_execute", Execute.self)
      _ = "{\"@type\":\"setLogVerbosityLevel\",\"new_verbosity_level\":0}".withCString { execute($0) }
      Self.handle = handle
    }
    let create = unsafeBitCast(dlsym(Self.handle, "td_create_client_id")!, to: Create.self)
    id = create()
    Self.callbacks[id] = { [weak self] value in DispatchQueue.main.async { self?.receive(value) } }
    if !Self.started {
      Self.started = true
      DispatchQueue(label: "BotHub.TDLib").async {
        while true {
          guard let ptr = Self.receiveFunction(0.3) else { continue }
          // Copy before the next td_receive invalidates the native pointer.
          let data = Data(String(cString: ptr).utf8)
          guard let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = (value["@client_id"] as? NSNumber)?.int32Value else { continue }
          Self.lock.lock(); let callback = Self.callbacks[id]; Self.lock.unlock()
          callback?(value)
          if let state = value["authorization_state"] as? [String: Any], state["@type"] as? String == "authorizationStateClosed" {
            Self.lock.lock(); Self.callbacks.removeValue(forKey: id); Self.lock.unlock()
          }
        }
      }
    }
  }
  enum Failure: LocalizedError {
    case message(String)
    case telegram(Int, String)
    var errorDescription: String? { switch self { case .message(let s): return s; case .telegram(let code, let s): return "\(code): \(s)" } }
  }
  func request(_ type: String, _ args: [String: Any] = [:]) async throws -> [String: Any] {
    guard !closing else { throw Failure.message("Connection closed") }
    sequence += 1; let extra = String(sequence)
    var value = args; value["@type"] = type; value["@extra"] = extra
    let json = String(data: try JSONSerialization.data(withJSONObject: value), encoding: .utf8)!
    return try await withCheckedThrowingContinuation { continuation in
      pending[extra] = continuation
      json.withCString { Self.sendFunction(id, $0) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 45) { [weak self] in
        self?.pending.removeValue(forKey: extra)?.resume(throwing: Failure.message("\(type) timed out"))
      }
    }
  }
  private func receive(_ value: [String: Any]) {
    if let extra = value["@extra"] as? String, let continuation = pending.removeValue(forKey: extra) {
      if value["@type"] as? String == "error" { continuation.resume(throwing: Failure.telegram((value["code"] as? NSNumber)?.intValue ?? 0, value["message"] as? String ?? "Telegram error")) }
      else { continuation.resume(returning: value) }
    } else { onUpdate?(value) }
    if let auth = value["authorization_state"] as? [String: Any], auth["@type"] as? String == "authorizationStateClosed" {
      closing = true
      for p in pending.values { p.resume(throwing: Failure.message("Connection closed")) }; pending.removeAll()
      closeWaiters.forEach { $0.resume() }; closeWaiters.removeAll()
    }
  }
  func close() async {
    if closing && closeWaiters.isEmpty { return }
    closing = true
    await withCheckedContinuation { continuation in
      closeWaiters.append(continuation)
      "{\"@type\":\"close\"}".withCString { Self.sendFunction(id, $0) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
        self?.closeWaiters.forEach { $0.resume() }; self?.closeWaiters.removeAll()
      }
    }
  }
}

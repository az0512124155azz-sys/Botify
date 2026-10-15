import ExpoModulesCore
import Foundation
import UIKit

@_silgen_name("td_create_client_id") private func tdCreate() -> Int32
@_silgen_name("td_send") private func tdSend(_ id: Int32, _ request: UnsafePointer<CChar>)
@_silgen_name("td_receive") private func tdReceive(_ timeout: Double) -> UnsafePointer<CChar>?
@_silgen_name("td_execute") private func tdExecute(_ request: UnsafePointer<CChar>) -> UnsafePointer<CChar>?

private enum TdPump {
  static let lock = NSLock()
  static var listeners: [Int32: (String) -> Void] = [:]
  static var running = false
  static var closing: [Int32: DispatchSemaphore] = [:]
  static func create(_ listener: @escaping (String) -> Void) -> Int32 {
    lock.lock(); defer { lock.unlock() }
    _ = "{\"@type\":\"setLogVerbosityLevel\",\"new_verbosity_level\":0}".withCString { tdExecute($0) }
    let id = tdCreate(); listeners[id] = listener
    if !running {
      running = true
      DispatchQueue(label: "BotHub.TDLib").async {
        while true {
          guard let ptr = tdReceive(0.3) else { continue }
          let json = String(cString: ptr)
          guard let data = json.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = (value["@client_id"] as? NSNumber)?.int32Value else { continue }
          lock.lock(); let callback = listeners[id]; lock.unlock()
          callback?(json)
          if let state = value["authorization_state"] as? [String: Any], state["@type"] as? String == "authorizationStateClosed" {
            lock.lock(); listeners.removeValue(forKey: id); let complete = closing.removeValue(forKey: id); lock.unlock(); complete?.signal()
          }
        }
      }
    }
    return id
  }
  static func close(_ id: Int32) -> DispatchSemaphore? {
    lock.lock()
    guard listeners[id] != nil else { lock.unlock(); return nil }
    let complete = closing[id] ?? DispatchSemaphore(value: 0)
    closing[id] = complete; listeners[id] = { _ in }; lock.unlock()
    "{\"@type\":\"close\"}".withCString { tdSend(id, $0) }
    return complete
  }
}
public class BotHubTdlibModule: Module {
  private var client: Int32?
  public func definition() -> ModuleDefinition {
    Name("BotHubTdlib")
    Events("onUpdate")
    AsyncFunction("start") { () throws -> [String: String] in
      guard self.client == nil else { throw NSError(domain: "BotHub", code: 1, userInfo: [NSLocalizedDescriptionKey: "TDLib is already running"]) }
      let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("BotHub")
      var database = base.appendingPathComponent("database")
      let files = base.appendingPathComponent("files")
      for path in [database, files] { try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true) }
      var flags = URLResourceValues(); flags.isExcludedFromBackup = true
      try database.setResourceValues(flags)
      self.client = TdPump.create { [weak self] json in self?.sendEvent("onUpdate", ["json": json]) }
      return ["database": database.path, "files": files.path]
    }
    Function("copyText") { (text: String) in
      if Thread.isMainThread { UIPasteboard.general.string = text }
      else { DispatchQueue.main.sync { UIPasteboard.general.string = text } }
    }
    Function("send") { (request: String) throws in
      guard let id = self.client else { throw NSError(domain: "BotHub", code: 2, userInfo: [NSLocalizedDescriptionKey: "TDLib is not started"]) }
      request.withCString { tdSend(id, $0) }
    }
    AsyncFunction("close") { () throws in
      let id = self.client; self.client = nil
      if let id, let complete = TdPump.close(id), complete.wait(timeout: .now() + 15) == .timedOut {
        throw NSError(domain: "BotHub", code: 3, userInfo: [NSLocalizedDescriptionKey: "TDLib close timed out"])
      }
    }
    OnDestroy { if let id = self.client { _ = TdPump.close(id) }; self.client = nil }
  }
}

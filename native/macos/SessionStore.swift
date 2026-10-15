import Foundation
import Security

enum SessionStore {
  static let service = "com.botify.bothub"
  static func read(_ name: String) throws -> Data? {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: name, kSecReturnData as String: true]
    var item: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw TdConnection.Failure.message("Keychain read failed: \(status)") }
    return item as? Data
  }
  static func save(_ name: String, _ data: Data) throws {
    let key: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: name]
    let update = SecItemUpdate(key as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if update == errSecItemNotFound {
      var value = key; value[kSecValueData as String] = data; value[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
      let status = SecItemAdd(value as CFDictionary, nil)
      guard status == errSecSuccess else { throw TdConnection.Failure.message("Keychain save failed: \(status)") }
    } else if update != errSecSuccess { throw TdConnection.Failure.message("Keychain update failed: \(update)") }
  }
  static func databaseKey(root: URL) throws -> String {
    if let key = try read("database-key") { return key.base64EncodedString() }
    if FileManager.default.fileExists(atPath: root.appendingPathComponent("database").path) { throw TdConnection.Failure.message("Database encryption key is missing. Restore the device key before reconnecting.") }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw TdConnection.Failure.message("Secure random generation failed") }
    let key = Data(bytes); try save("database-key", key); return key.base64EncodedString()
  }
}

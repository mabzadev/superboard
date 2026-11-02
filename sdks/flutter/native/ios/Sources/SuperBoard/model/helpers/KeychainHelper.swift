import Foundation
import Security

protocol KeychainHelperProtocol {
    func getValue(forKey key: KeychainKeys) -> String?
}

enum KeychainKeys: String {
    case linksquaredID
}

class KeychainHelper {

    @discardableResult
    static func setValue(_ value: String, forKey key: KeychainKeys) -> Bool {
        if let data = value.data(using: .utf8) {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: key.rawValue,
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
            ]

            SecItemDelete(query as CFDictionary)

            let status = SecItemAdd(query as CFDictionary, nil)
            return status == errSecSuccess
        }
        return false
    }

    static func getValue(forKey key: KeychainKeys) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: kCFBooleanTrue!,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var dataTypeRef: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &dataTypeRef)

        if status == errSecSuccess {
            if let data = dataTypeRef as? Data {
                return String(data: data, encoding: .utf8)
            }
        }
        return nil
    }

    @discardableResult
    static func removeValue(forKey key: KeychainKeys) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key.rawValue
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess
    }
}

extension KeychainHelper: KeychainHelperProtocol {
    func getValue(forKey key: KeychainKeys) -> String? {
        KeychainHelper.getValue(forKey: key)
    }
}

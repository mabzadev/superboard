import Foundation

protocol UserDefaultsHelperProtocol {
    func getInt(key: UserDefaultsKeys) -> Int
    func setInt(value: Int, key: UserDefaultsKeys)
}

enum UserDefaultsKeys: String {
    case superboardNumberOfOpens
    case superboardResignTimestamp
    case superboardLastStartTimestamp
}

@objc
class UserDefaultsHelper: NSObject {

    private static let userDefaultsGroup: UserDefaults = UserDefaults.standard

    static func set(string: String, key: UserDefaultsKeys) {
        userDefaultsGroup.setValue(string, forKey: key.rawValue)

    }

    static func getString(key: UserDefaultsKeys) -> String? {
        return userDefaultsGroup.string(forKey: key.rawValue)
    }

    static func set(boolean: Bool, key: UserDefaultsKeys) {
        userDefaultsGroup.set(boolean, forKey: key.rawValue)

    }

    static func getBoolean(key: UserDefaultsKeys) -> Bool {
        return userDefaultsGroup.bool(forKey: key.rawValue)
    }

    static func set(value: Int, key: UserDefaultsKeys) {
        userDefaultsGroup.set(value, forKey: key.rawValue)

    }

    static func getInt(key: UserDefaultsKeys) -> Int {
        return userDefaultsGroup.integer(forKey: key.rawValue)
    }

    static func set(array: [String], key: UserDefaultsKeys) {
        userDefaultsGroup.setValue(array, forKey: key.rawValue)

    }

    static func getStringArray(key: UserDefaultsKeys) -> [String]? {
        return userDefaultsGroup.stringArray(forKey: key.rawValue)
    }

    static func containsItem(for key: UserDefaultsKeys) -> Bool {
        return userDefaultsGroup.object(forKey: key.rawValue) != nil
    }

    static func remove(key: UserDefaultsKeys) {
        userDefaultsGroup.removeObject(forKey: key.rawValue)

    }
}

extension UserDefaultsHelper: UserDefaultsHelperProtocol {
    func getInt(key: UserDefaultsKeys) -> Int {
        UserDefaultsHelper.getInt(key: key)
    }

    func setInt(value: Int, key: UserDefaultsKeys) {
        UserDefaultsHelper.set(value: value, key: key)
    }
}

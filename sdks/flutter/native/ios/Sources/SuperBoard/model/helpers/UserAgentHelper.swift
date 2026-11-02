
import Foundation

class UserAgentHelper {

    static func applicationUserAgent() -> String {
        let bundle = Bundle.main.bundleIdentifier ?? "unknown-bundle"
        let version = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "unknown-version"
        let operatingSystem = ProcessInfo.processInfo.operatingSystemVersionString
        return "\(bundle)/\(version) SuperBoard-iOS (\(operatingSystem))"
    }

    static func getApplicationUserAgent(completion: @escaping (String) -> Void) {
        completion(applicationUserAgent())
    }
}

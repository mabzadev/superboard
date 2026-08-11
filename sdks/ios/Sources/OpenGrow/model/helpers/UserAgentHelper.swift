//
//  UserAgentHelper.swift
//
//  opengrow
//


import Foundation

// MARK: - UserAgentHelper

/// A utility class for building an application-scoped SDK user agent.
class UserAgentHelper {

    /// Builds a deterministic user agent without launching a WebKit process.
    ///
    /// - Returns: A stable value containing the host bundle, version and OS.
    static func applicationUserAgent() -> String {
        let bundle = Bundle.main.bundleIdentifier ?? "unknown-bundle"
        let version = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "unknown-version"
        let operatingSystem = ProcessInfo.processInfo.operatingSystemVersionString
        return "\(bundle)/\(version) OpenGrow-iOS (\(operatingSystem))"
    }

    /// Preserves the asynchronous manager contract without a separate process.
    static func getApplicationUserAgent(completion: @escaping (String) -> Void) {
        completion(applicationUserAgent())
    }
}

//
//  BaseService.swift
//
//  opengrow
//

import Foundation

/// Closure typealias for JSON response handling
public typealias JSONClosure = (_ success: Bool, _ json: [String: Any]?) -> Void

/// Base service class for making network requests
open class BaseService: NSObject {

    /// Injectable foreground transport used by unit tests. Keeping the retry
    /// policy above the URL loading system avoids asking CFNetwork to interpret
    /// synthetic connectivity failures before the policy can observe them.
    typealias ForegroundRequestExecutor = (
        _ request: URLRequest,
        _ completion: @escaping (Data?, URLResponse?, Error?) -> Void
    ) -> URLSessionTask?

    /// Injectable retry scheduler used by unit tests to execute retries without
    /// wall-clock sleeps while production retains exponential backoff.
    typealias RetryScheduler = (
        _ delay: TimeInterval,
        _ operation: @escaping () -> Void
    ) -> Void

    // MARK: - Properties

    /// URLProtocol classes to prepend to the session configuration (used for testing).
    static var urlProtocolClasses: [AnyClass] = []

    /// Configuration for background URLSession.
    /// Uses a stable identifier derived from the bundle ID so the system can
    /// reconnect to the session after an app kill and deliver pending events.
    private let backgroundConfig = URLSessionConfiguration.background(
        withIdentifier: "io.opengrow.sdk.background.\(Bundle.main.bundleIdentifier ?? "default")"
    )

    /// Default URLSession configuration
    private let config = URLSessionConfiguration.default

    /// Operation queue for delegate callbacks
    private let delegateQueue = OperationQueue()

    /// URLSession instance for regular requests
    private var session: URLSession!

    /// URLSession instance for background requests
    private var backgroundSession: URLSession!

    /// Cached completion handlers for background requests, keyed by task identifier
    private var cachedCompletions: [Int: JSONClosure] = [:]

    /// Serial queue protecting cachedCompletions from concurrent access
    private let completionsQueue = DispatchQueue(label: "com.opengrow.completionsQueue")

    /// Dedicated scheduler for retries. Network recovery is user-visible work, so
    /// avoid utility QoS: it can be deferred for tens of seconds while the process
    /// is busy and make a short exponential backoff miss its intended window.
    private let retryQueue = DispatchQueue(label: "io.opengrow.sdk.retry", qos: .userInitiated)

    /// Optional transport and scheduler seams. Production uses URLSession and
    /// the dedicated retry queue; tests inject deterministic implementations.
    private var foregroundRequestExecutor: ForegroundRequestExecutor?
    private var retryScheduler: RetryScheduler?

    /// Maximum number of retries per request before giving up
    private static let maxRetryCount = 5


    // MARK: - Initialization

    override init() {
        foregroundRequestExecutor = nil
        retryScheduler = nil

        delegateQueue.name = "background-queue-opengrow"
        config.sessionSendsLaunchEvents = true

        let bgConfig: URLSessionConfiguration
        if !BaseService.urlProtocolClasses.isEmpty {
            config.protocolClasses = BaseService.urlProtocolClasses + (config.protocolClasses ?? [])
            // Background sessions ignore custom URLProtocol classes, so use
            // a default config with the mock protocols for in-process testing.
            let testBgConfig = URLSessionConfiguration.default
            testBgConfig.protocolClasses = BaseService.urlProtocolClasses + (testBgConfig.protocolClasses ?? [])
            bgConfig = testBgConfig
        } else {
            bgConfig = backgroundConfig
        }

        super.init()

        session = URLSession(configuration: config, delegate: nil, delegateQueue: delegateQueue)
        backgroundSession = URLSession(configuration: bgConfig, delegate: self, delegateQueue: delegateQueue)

    }

    convenience init(
        foregroundRequestExecutor: ForegroundRequestExecutor?,
        retryScheduler: RetryScheduler?
    ) {
        self.init()
        self.foregroundRequestExecutor = foregroundRequestExecutor
        self.retryScheduler = retryScheduler
    }

    // MARK: - Request Methods

    /// Makes a network request with the given URLRequest.
    ///
    /// - Parameters:
    ///   - background: Indicates if the request should be made in the background.
    ///   - URLRequest: The URLRequest to be executed.
    ///   - completion: Completion handler to be called when the request finishes.

    @discardableResult
    func makeRequest(background: Bool = false, URLRequest: URLRequest, completion: @escaping JSONClosure) -> URLSessionTask? {
        return makeRequest(background: background, URLRequest: URLRequest, retryCount: 0, completion: completion)
    }

    /// Per-request exponential backoff with jitter: base delay 2, 4, 8, 16, 32s (capped at 60)
    /// plus random jitter of 0–1s to prevent thundering herd on network recovery.
    private func retryDelay(for retryCount: Int) -> Double {
        let base = min(2.0 * pow(2.0, Double(retryCount)), 60.0)
        let jitter = Double.random(in: 0...1.0)
        return base + jitter
    }

    private func scheduleRetry(after delay: TimeInterval, operation: @escaping () -> Void) {
        if let retryScheduler {
            retryScheduler(delay, operation)
            return
        }

        retryQueue.asyncAfter(deadline: .now() + delay, execute: operation)
    }

    private static func isRetryableTransportError(_ error: Error?) -> Bool {
        guard let code = (error as? URLError)?.code else { return false }

        switch code {
        case .networkConnectionLost, .notConnectedToInternet, .timedOut:
            return true
        default:
            return false
        }
    }

    @discardableResult
    private func makeRequest(background: Bool, URLRequest: URLRequest, retryCount: Int, completion: @escaping JSONClosure) -> URLSessionTask? {
        if background {
            let task = backgroundSession.downloadTask(with: URLRequest)
            completionsQueue.sync { cachedCompletions[task.taskIdentifier] = completion }
            task.resume()

            return task

        } else {

            let responseHandler: (Data?, URLResponse?, Error?) -> Void = { data, urlResponse, error in
                if Self.isRetryableTransportError(error) {
                    guard retryCount < Self.maxRetryCount else {
                        let errorCode = (error as? URLError)?.code.rawValue ?? URLError.unknown.rawValue
                        DebugLogger.shared.log(.error, "Request failed after \(Self.maxRetryCount) retries: \(errorCode)")
                        DispatchQueue.main.async { completion(false, nil) }
                        return
                    }

                    let delay = self.retryDelay(for: retryCount)
                    self.scheduleRetry(after: delay) {
                        self.makeRequest(background: background, URLRequest: URLRequest, retryCount: retryCount + 1, completion: completion)
                    }

                    return
                }

                guard error == nil, let data = data, let http = urlResponse as? HTTPURLResponse else {
                    DispatchQueue.main.async {
                        completion(false, nil)
                    }
                    return
                }

                // Respect 429 Too Many Requests — back off using Retry-After or exponential delay
                if http.statusCode == 429 {
                    guard retryCount < Self.maxRetryCount else {
                        DispatchQueue.main.async { completion(false, nil) }
                        return
                    }

                    let retryAfter = (http.value(forHTTPHeaderField: "Retry-After") as NSString?)?.doubleValue
                    let delay = retryAfter ?? self.retryDelay(for: retryCount)
                    self.scheduleRetry(after: delay) {
                        self.makeRequest(background: background, URLRequest: URLRequest, retryCount: retryCount + 1, completion: completion)
                    }
                    return
                }

                do {
                    if let json = try JSONSerialization.jsonObject(with: data, options: .mutableContainers) as? [String: Any] {
                        DispatchQueue.main.async {
                            completion(http.statusCode == 200, json)
                        }
                        return
                    }

                    if let json = try JSONSerialization.jsonObject(with: data, options: .mutableContainers) as? [[String: Any]] {
                        DispatchQueue.main.async {
                            completion(http.statusCode == 200, ["value":json])
                        }
                        return
                    }

                } catch _ {}

                DispatchQueue.main.async {
                    completion(false, nil)
                }
            }

            if let foregroundRequestExecutor {
                return foregroundRequestExecutor(URLRequest, responseHandler)
            }

            let task = session.dataTask(with: URLRequest, completionHandler: responseHandler)

            task.resume()

            return task
        }
    }

}

// MARK: - URLSessionDownloadDelegate

extension BaseService: URLSessionDownloadDelegate {

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let completion = completionsQueue.sync { cachedCompletions.removeValue(forKey: task.taskIdentifier) }
        completion?(false, nil)
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {

        let completion = completionsQueue.sync { cachedCompletions.removeValue(forKey: downloadTask.taskIdentifier) }

        do {
            let data = try Data(contentsOf: location)
            if let json = try JSONSerialization.jsonObject(with: data, options: .mutableContainers) as? [String: Any] {

                // Success
                completion?(true, json)
                return
            }

        } catch {}

        completion?(false, nil)
    }
}

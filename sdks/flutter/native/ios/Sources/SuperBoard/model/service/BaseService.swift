import Foundation

public typealias JSONClosure = (_ success: Bool, _ json: [String: Any]?) -> Void

open class BaseService: NSObject {

    typealias ForegroundRequestExecutor = (
        _ request: URLRequest,
        _ completion: @escaping (Data?, URLResponse?, Error?) -> Void
    ) -> URLSessionTask?

    typealias RetryScheduler = (
        _ delay: TimeInterval,
        _ operation: @escaping () -> Void
    ) -> Void

    static var urlProtocolClasses: [AnyClass] = []

    private let backgroundConfig = URLSessionConfiguration.background(
        withIdentifier: "io.superboard.sdk.background.\(Bundle.main.bundleIdentifier ?? "default")"
    )

    private let config = URLSessionConfiguration.default

    private let delegateQueue = OperationQueue()

    private var session: URLSession!

    private var backgroundSession: URLSession!

    private var cachedCompletions: [Int: JSONClosure] = [:]

    private let completionsQueue = DispatchQueue(label: "com.superboard.completionsQueue")

    private let retryQueue = DispatchQueue(label: "io.superboard.sdk.retry", qos: .userInitiated)

    private var foregroundRequestExecutor: ForegroundRequestExecutor?
    private var retryScheduler: RetryScheduler?

    private static let maxRetryCount = 5


    override init() {
        foregroundRequestExecutor = nil
        retryScheduler = nil

        delegateQueue.name = "background-queue-superboard"
        config.sessionSendsLaunchEvents = true

        let bgConfig: URLSessionConfiguration
        if !BaseService.urlProtocolClasses.isEmpty {
            config.protocolClasses = BaseService.urlProtocolClasses + (config.protocolClasses ?? [])
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

    @discardableResult
    func makeRequest(background: Bool = false, URLRequest: URLRequest, completion: @escaping JSONClosure) -> URLSessionTask? {
        return makeRequest(background: background, URLRequest: URLRequest, retryCount: 0, completion: completion)
    }

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

                completion?(true, json)
                return
            }

        } catch {}

        completion?(false, nil)
    }
}

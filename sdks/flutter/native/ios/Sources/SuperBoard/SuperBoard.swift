import UIKit

public protocol SuperBoardDelegate: AnyObject {
    func superboardReceivedPayloadFromDeeplink(link: String?, payload: [String: Any]?, tracking: [String: Any]?)
}

public class SuperBoard {

    private static let stateLock = NSLock()
    private static var _manager: SuperBoardManager?
    private static var _APIKey: String?

    private static var manager: SuperBoardManager? {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _manager }
        set { stateLock.lock(); defer { stateLock.unlock() }; _manager = newValue }
    }

    private static var APIKey: String? {
        get { stateLock.lock(); defer { stateLock.unlock() }; return _APIKey }
        set { stateLock.lock(); defer { stateLock.unlock() }; _APIKey = newValue }
    }

    private static func onMain(_ block: @escaping () -> Void) {
        if Thread.isMainThread {
            block()
        } else {
            DispatchQueue.main.async(execute: block)
        }
    }

    public static var delegate: SuperBoardDelegate? {
        set {
            let value = newValue
            onMain {
                self.manager?.delegate = value
            }
        }

        get {
            assert(Thread.isMainThread, "SuperBoard.delegate must be read on the main thread")
            return manager?.delegate
        }
    }

    public static func configure(APIKey: String, useTestEnvironment: Bool, baseURL: String? = nil, delegate: SuperBoardDelegate?, completion: SuperBoardBoolCompletion? = nil) {
        onMain {
            self.APIKey = APIKey
            self.manager = SuperBoardManager(apiKey: APIKey, useTestEnvironment: useTestEnvironment, baseURL: baseURL, delegate: delegate)

            if useTestEnvironment {
                DebugLogger.shared.log(.info, "Test environment enabled.")
            }

            self.checkConfiguration(completion: completion)
        }
    }

    public static func setSDK(enabled: Bool) {
        onMain {
            guard let manager else {
                DebugLogger.shared.log(.error, "The SDK is not configured. Setting SDK enabled won't work.")
                return
            }

            manager.setEnabled(enabled)
        }
    }

    public static var userIdentifier: String? {
        set {
            let value = newValue
            onMain {
                guard let manager else {
                    DebugLogger.shared.log(.error, "The SDK is not configured. Setting the user identifier won't work.")
                    return
                }

                manager.identifier = value
            }
        }
        get {
            manager?.identifier
        }
    }

    public static var userAttributes: [String: Any]? {
        set {
            let value = newValue
            onMain {
                guard let manager = self.manager else {
                    DebugLogger.shared.log(.error, "The SDK is not configured. Setting user attributes won't work.")
                    return
                }

                manager.attributes = value
            }
        }
        get {
            manager?.attributes
        }
    }

    public static var pushToken: String? {
        set {
            let value = newValue
            onMain {
                guard let manager = self.manager else {
                    DebugLogger.shared.log(.error, "The SDK is not configured. Setting the push token won't work.")
                    return
                }

                manager.pushToken = value
            }
        }
        get {
            manager?.pushToken
        }
    }

    public static func setDebug(level: LogLevel) {
        DebugLogger.shared.logLevel = level
    }

    public static func generateLink(title: String? = nil,
                                    subtitle: String? = nil,
                                    imageURL: String? = nil,
                                    data: [String: Any]? = nil,
                                    tags: [String]? = nil,
                                    customRedirects: CustomRedirects? = nil,
                                    showPreviewiOS: Bool? = nil,
                                    showPreviewAndroid: Bool? = nil,
                                    trackingCampaign: String? = nil,
                                    trackingSource: String? = nil,
                                    trackingMedium: String? = nil,
                                    completion: @escaping SuperBoardURLClosure) {
        onMain {
            guard let manager else {
                DebugLogger.shared.log(.error, "The SDK is not configured. Links cannot be generated.")
                completion(nil)
                return
            }

            manager.generateLink(title: title,
                                 subtitle: subtitle,
                                 imageURL: imageURL,
                                 data: data,
                                 tags: tags,
                                 customRedirects: customRedirects,
                                 showPreviewiOS: showPreviewiOS,
                                 showPreviewAndroid: showPreviewAndroid,
                                 trackingCampaign: trackingCampaign,
                                 trackingSource: trackingSource,
                                 trackingMedium: trackingMedium,
                                 completion: completion)
        }
    }

    public static func lastReceivedPayload(completion: @escaping SuperBoardPayloadClosure) {
        onMain {
            guard let manager else {
                DebugLogger.shared.log(.error, "The SDK is not configured. Last received payloads won't work.")
                completion(nil)
                return
            }

            manager.getLastPayload(completion: completion)
        }
    }

    public static func allReceivedPayloadsSinceStartup(completion: @escaping SuperBoardPayloadsClosure) {
        onMain {
            guard let manager else {
                DebugLogger.shared.log(.error, "The SDK is not configured. Fetching the payloads won't work.")
                completion(nil)
                return
            }

            manager.getAllPayloadsSinceStartup(completion: completion)
        }
    }

    public static func linkDetails(path: String, completion: @escaping SuperBoardLinkClosure) {
        onMain {
            guard let manager else {
                DebugLogger.shared.log(.error, "The SDK is not configured. Link details won't work.")
                completion(nil)
                return
            }

            manager.getLinkDetails(path: path, completion: completion)
        }
    }

    private static func checkConfiguration(completion: SuperBoardBoolCompletion? = nil) {
        guard let APIKey = APIKey, APIKey.count > 0 else {
            DebugLogger.shared.log(.error, "API Key is invalid. Use the value issued by the configured SuperBoard dashboard.")
            self.manager = nil
            completion?(false)
            return
        }

        manager?.authenticate { success in
            if !success {
                DebugLogger.shared.log(.error, "Can not initialize the SDK, the Bundle Key combo is invalid")
            } else {
                self.manager?.start()
            }
            completion?(success)
        }
    }
}

extension SuperBoard {
    @available(iOS 13.0, *)
    public static func handleSceneDelegate(openURLContexts URLContexts: Set<UIOpenURLContext>) {
        onMain {
            manager?.handleSceneDelegate(openURLContexts: URLContexts)
        }
    }

    public static func handleSceneDelegate(continue userActivity: NSUserActivity) {
        onMain {
            manager?.handleSceneDelegate(continue: userActivity)
        }
    }

    @available(iOS 13.0, *)
    public static func handleSceneDelegate(options connectionOptions: UIScene.ConnectionOptions) {
        onMain {
            manager?.handleSceneDelegate(connectionOptions: connectionOptions)
        }
    }
}


extension SuperBoard {

    public static func handleAppDelegate(continue userActivity: NSUserActivity,
                                         restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        assert(Thread.isMainThread, "handleAppDelegate(continue:) must be called on the main thread")
        return manager?.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler) ?? false
    }

    public static func handleAppDelegate(open url: URL, options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
        assert(Thread.isMainThread, "handleAppDelegate(open:) must be called on the main thread")
        return manager?.handleAppDelegate(open: url, options: options) ?? false
    }
}


extension SuperBoard {
    public static func displayMessagesViewController(completion: SuperBoardEmptyClosure?) {
        onMain {
            guard let manager else {
                DebugLogger.shared.log(.error, "The SDK is not configured. Displaying messages won't work.")
                completion?()
                return
            }

            manager.displayMessagesViewController(completion: completion)
        }
    }

    public static func numberOfUnreadMessages(completion: @escaping SuperBoardIntClosure) {
        onMain {
            guard let manager else {
                DebugLogger.shared.log(.error, "The SDK is not configured. Number of unread messages won't work.")
                completion(nil)
                return
            }

            manager.getNumberOfUnreadNotifications(completion: completion)
        }
    }
}

extension SuperBoard {
    public static func logInAppPurchase(transactionID: UInt64, completion: @escaping SuperBoardBoolCompletion) {
        onMain {
            guard let manager else {
                DebugLogger.shared.log(.error, "The SDK is not configured. Sending payment events won't work.")
                completion(false)
                return
            }

            manager.logInAppPurchase(transactionID: transactionID, completion: completion)
        }
    }

    public static func logCustomPurchase(type: TransactionType,
                                         priceInCents: Int,
                                         currency: String,
                                         productID: String,
                                         startDate: Date? = nil,
                                         completion: @escaping SuperBoardBoolCompletion) {

        onMain {
            guard let manager else {
                DebugLogger.shared.log(.error, "The SDK is not configured. Sending payment events won't work.")
                completion(false)
                return
            }

            manager.logCustomPurchase(type: type, priceInCents: priceInCents, currency: currency, productID: productID, startDate: startDate, completion: completion)
        }
    }
}

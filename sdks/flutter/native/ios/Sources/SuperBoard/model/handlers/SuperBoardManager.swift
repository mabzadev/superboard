import Foundation
import UIKit

public typealias SuperBoardBoolCompletion = (_ value: Bool) -> Void

class SuperBoardManager {

    private struct Constants {
        static let deviceIDKey = "linkdsquare_device_id"
        static let maxQueuedActions = 1000
    }

    private func assertMainThread(_ function: StaticString = #function) {
        assert(Thread.isMainThread, "SuperBoardManager.\(function) must be called on the main thread")
    }

    private var apiService: APIService

    private let apiKey: String

    private let bundleID: String

    private var enabled = true

    private var authenticated = false {
        didSet {
            authenticationChanged()
            handleActions()
        }
    }

    private var urlToHandle: String?

    private let eventsHandler: EventsHandler

    private let paymentEventsHandler: PaymentEventsHandler

    private var receivedPayloads = [[String: Any]]()

    private var handledAppOrSceneDelegates = false {
        didSet {
            self.eventsHandler.handledAppOrSceneDelegates = handledAppOrSceneDelegates
        }
    }

    private var lastPayloadClosureArray = [SuperBoardPayloadClosure]()

    private var payloadsClosureArray = [SuperBoardPayloadsClosure]()

    private var shouldUpdateAttributes = false

    weak var delegate: SuperBoardDelegate?

    var identifier: String? {
        set {
            Context.identifier = newValue
            updateAttributesIfNeeded()
        }
        get {
            Context.identifier
        }
    }

    var attributes: [String: Any]? {
        set {
            Context.attributes = newValue
            updateAttributesIfNeeded()
        }
        get {
            Context.attributes
        }
    }

    var pushToken: String? {
        set {
            Context.pushToken = newValue
            updateAttributesIfNeeded()
        }
        
        get {
            Context.pushToken
        }
    }

    private let notificationsDisplayDispatchGroup = DispatchGroup()
    private var displayedNotificationsIds = [Int]()
    private var actions = [SuperBoardAction]()
    private var handlingURL = false

    init(apiKey: String, useTestEnvironment: Bool, baseURL: String? = nil, delegate: SuperBoardDelegate?) {
        self.apiKey = apiKey
        self.bundleID = AppDetailsHelper.getBundleID()
        self.delegate = delegate
        self.apiService = APIService(apiKey: apiKey, bundleID: self.bundleID, useTestEnvironment: useTestEnvironment, baseURL: baseURL)
        self.eventsHandler = EventsHandler(apiService: self.apiService)
        self.paymentEventsHandler = PaymentEventsHandler(apiService: self.apiService)

        addObservers()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func setEnabled(_ enabled: Bool) {
        assertMainThread()
        self.enabled = enabled
        DebugLogger.shared.log(.info, "SDK setEnabled to: \(enabled)")
    }

    func start() {
    }

    func generateLink(title: String?,
                      subtitle: String?,
                      imageURL: String?,
                      data: [String: Any]?,
                      tags: [String]?,
                      customRedirects: CustomRedirects?,
                      showPreviewiOS: Bool?,
                      showPreviewAndroid: Bool?,
                      trackingCampaign: String? = nil,
                      trackingSource: String? = nil,
                      trackingMedium: String? = nil,
                      completion: @escaping SuperBoardURLClosure) {
        guard enabled else {
            DebugLogger.shared.log(.error, "The SDK is not enabled. Links cannot be generated.")
            completion(nil)
            return
        }

        guard authenticated else {
            let action = SuperBoardAction(mainBlock: {
                self.generateLink(title: title,
                                  subtitle: subtitle,
                                  imageURL: imageURL,
                                  data: data,
                                  tags: tags,
                                  customRedirects: customRedirects,
                                  showPreviewiOS: showPreviewiOS,
                                  showPreviewAndroid: showPreviewAndroid,
                                  completion: completion)
            }, failureBlock: {
                completion(nil)
            })
            enqueueAction(action)

            return
        }

        do {
            var jsonString: String?
            if let data = data {
                let jsonData = try JSONSerialization.data(withJSONObject: data, options: .prettyPrinted)
                jsonString = String(data: jsonData, encoding: .utf8)
            }

            var tagsString: String?
            if let tags = tags {
                let jsonData = try JSONSerialization.data(withJSONObject: tags, options: .prettyPrinted)
                tagsString = String(data: jsonData, encoding: .utf8)
            }

            apiService.generateLink(title: title,
                                    subtitle: subtitle,
                                    imageURL: imageURL,
                                    data: jsonString,
                                    tags: tagsString,
                                    customRedirects: customRedirects,
                                    showPreviewiOS: showPreviewiOS,
                                    showPreviewAndroid: showPreviewAndroid,
                                    trackingCampaign: trackingCampaign,
                                    trackingSource: trackingSource,
                                    trackingMedium: trackingMedium,
                                    completion: completion)
            return
        } catch {
            DebugLogger.shared.log(.error, "Failed to convert data to JSON: \(error.localizedDescription)")
        }

        completion(nil)
    }

    func getLastPayload(completion: @escaping SuperBoardPayloadClosure) {
        assertMainThread()
        lastPayloadClosureArray.append(completion)

        handlePayloadsReceivedIfNeeded()
    }

    func getAllPayloadsSinceStartup(completion: @escaping SuperBoardPayloadsClosure) {
        assertMainThread()
        payloadsClosureArray.append(completion)

        handlePayloadsReceivedIfNeeded()
    }

    func authenticate(completion: @escaping SuperBoardBoolCompletion) {
        assertMainThread()
        guard hasURISchemesConfigured() else {
            DebugLogger.shared.log(.error, "URI schemes are not configured. SDK won't work!")
            completion(false)
            return
        }

        handleUserAgent {
            self.apiService.authenticate(appDetails: AppDetailsHelper.getAppDetails()) { success, linksquaredID, uriScheme, identifier, attributes in
                guard let linksquaredID = linksquaredID, let uriScheme = uriScheme, success else {
                    self.authenticated = false
                    completion(false)

                    return
                }

                Context.linksquaredID = linksquaredID

                if !self.shouldUpdateAttributes {
                    Context.identifier = identifier
                    Context.attributes = attributes
                }

                self.authenticated = true

                self.checkIfURISchemeProperlySet(uriScheme: uriScheme)
                self.handleURLIfNeeded()
                self.getDataForDevice()
                self.updateAttributesIfNeeded()

                completion(true)
            }
        }
    }
    func getNotifications(page: Int, completion: @escaping SuperBoardNotificationsClosure) {
        guard authenticated else {
            let action = SuperBoardAction(mainBlock: {
                self.getNotifications(page: page, completion: completion)
            }, failureBlock: {
                completion(nil)
            })
            enqueueAction(action)

            return
        }

        apiService.notifications(page: page, completion: completion)
    }

    func getNumberOfUnreadNotifications(completion: @escaping SuperBoardIntClosure) {
        guard authenticated else {
            let action = SuperBoardAction(mainBlock: {
                self.getNumberOfUnreadNotifications(completion: completion)
            }, failureBlock: {
                completion(nil)
            })
            enqueueAction(action)

            return
        }

        apiService.numberOfUnreadNotifications(completion: completion)
    }

    func displayMessagesViewController(completion: SuperBoardEmptyClosure?) {
        guard authenticated else {
            let action = SuperBoardAction(mainBlock: {
                self.displayMessagesViewController(completion: completion)
            }, failureBlock: {
                completion?()
            })
            enqueueAction(action)

            return
        }

        let nav = UINavigationController()
        nav.navigationBar.isHidden = true

        if let vc = MessagesViewController.loadVCFromNib()  {
            vc.manager = self
            vc.dismissalDelegate = DismissalDelegate.shared

            nav.viewControllers = [vc]
            nav.presentationController?.delegate = DismissalDelegate.shared
            DismissalDelegate.shared.completion = completion

            Presenter.presentOnTop(nav)
        }
    }

    func markNotificationAsRead(notificationID: Int, completion: @escaping SuperBoardBoolCompletion) {
        guard authenticated else {
            let action = SuperBoardAction(mainBlock: {
                self.markNotificationAsRead(notificationID: notificationID, completion: completion)
            }, failureBlock: {
                completion(false)
            })
            enqueueAction(action)

            return
        }

        apiService.markNotificationAsRead(notificationID: notificationID, completion: completion)
    }

    func getLinkDetails(path: String, completion: @escaping SuperBoardLinkClosure) {
        guard authenticated else {
            let action = SuperBoardAction(mainBlock: {
                self.getLinkDetails(path: path, completion: completion)
            }, failureBlock: {
                completion(nil)
            })
            enqueueAction(action)

            return
        }

        apiService.linkDetails(path: path, completion: completion)
    }


    @objc func applicationDidBecomeActive() {
        getDataForDevice()
    }

    @objc func applicationWillResignActive() {
    }

    func hasURISchemesConfigured() -> Bool {
        guard let urlTypes = Bundle.main.infoDictionary?["CFBundleURLTypes"] as? [[String: Any]] else {
            return false
        }
        return !urlTypes.isEmpty
    }

    private func updateAttributesIfNeeded() {
        if !authenticated {
            shouldUpdateAttributes = true
            return
        }

        apiService.updateAttributes { value in
            if value {
                self.shouldUpdateAttributes = false
            }
        }
    }

    private func handleUserAgent(completion: @escaping SuperBoardEmptyClosure) {
        UserAgentHelper.getApplicationUserAgent { userAgent in
            Context.userAgent = userAgent
            completion()
        }
    }

    private func handlePayloadsReceivedIfNeeded() {
        guard authenticated, handledAppOrSceneDelegates else {
            return
        }

        DispatchQueue.main.async {
            self.payloadsClosureArray.forEach { closure in
                closure(self.receivedPayloads)
            }
            self.payloadsClosureArray.removeAll()

            self.lastPayloadClosureArray.forEach { closure in
                closure(self.receivedPayloads.last)
            }
            self.lastPayloadClosureArray.removeAll()
        }
    }

    private func handleURLIfNeeded() {
        if let urlToHandle = urlToHandle {
            handleURL(url: urlToHandle)
        }
    }

    private func addObservers() {
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(applicationDidBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification,
                                               object: nil)

        NotificationCenter.default.addObserver(self,
                                               selector: #selector(applicationWillResignActive),
                                               name: UIApplication.willResignActiveNotification,
                                               object: nil)
    }

    private func getDataForDevice() {
        guard enabled, authenticated, handlingURL == false else {
            return
        }

        self.apiService.payloadFor(appDetails: AppDetailsHelper.getAppDetails()) { payload, link, tracking in
            self.eventsHandler.setLinkToNewFutureActions(link: link, completion: {
                self.displayAutomaticNotificationsIfNeeded()
            })

            self.handleReceivedAction(link: link, payload: payload, tracking: tracking)
        }
    }

    private func handleURL(url: String) {
        assertMainThread()
        guard enabled else {
            return
        }

        if !authenticated {
            urlToHandle = url
            return
        }

        handlingURL = true
        apiService.payloadFor(appDetails: AppDetailsHelper.getAppDetails(), url: url) { payload, link, tracking in
            self.eventsHandler.setLinkToNewFutureActions(link: link, completion: nil)
            self.handleReceivedAction(link: link, payload: payload, tracking: tracking)

            self.handlingURL = false
        }
    }

    private func handleReceivedAction(link: String?, payload: [String: Any]?, tracking: [String: Any]?) {
        assertMainThread()
        if let payload = payload {
            receivedPayloads.append(payload)
        }

        if link != nil || payload != nil {
            DispatchQueue.main.async { [weak self] in
                self?.delegate?.superboardReceivedPayloadFromDeeplink(link: link, payload: payload, tracking: tracking)
            }
        }

        handlePayloadsReceivedIfNeeded()
    }

    private func displayAutomaticNotificationsIfNeeded() {
        apiService.notificationsToDisplayAutomatically { notifications in
            guard let notifications = notifications else {
                return
            }

            self.automaticallyDisplayNotifications(notifications: notifications)
        }
    }

    private func automaticallyDisplayNotifications(notifications: [SuperBoardNotification]) {
        DispatchQueue.global(qos: .background).async { [weak self] in
            guard let self else { return }
            for notification in notifications {
                self.notificationsDisplayDispatchGroup.enter()

                self.displayNotification(notification: notification) { [weak self] in
                    self?.notificationsDisplayDispatchGroup.leave()
                }

                self.notificationsDisplayDispatchGroup.wait()
            }
        }
    }

    private func displayNotification(notification: SuperBoardNotification, completion: @escaping SuperBoardEmptyClosure) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                completion()
                return
            }

            if self.displayedNotificationsIds.contains(notification.id) {
                completion()
                return
            }

            if let vc = MessageDetailsViewController.loadVCFromNib() {
                vc.notification = notification
                vc.manager = self

                Presenter.presentOnTop(vc, animated: false) { [weak self] in
                    self?.displayedNotificationsIds.append(notification.id)
                    completion()
                }
            }
        }
    }

    private func authenticationChanged() {
        if authenticated {
            paymentEventsHandler.start()
        }
    }

    private func enqueueAction(_ action: SuperBoardAction) {
        assertMainThread()
        if actions.count >= Constants.maxQueuedActions {
            let evicted = actions.removeFirst()
            evicted.failureBlock()
        }
        actions.append(action)
    }

    private func handleActions() {
        assertMainThread()
        for action in actions {
            if authenticated {
                action.mainBlock()
            } else {
                action.failureBlock()
            }
        }

        actions.removeAll()
    }
}

extension SuperBoardManager {

    @available(iOS 13.0, *)
    func handleSceneDelegate(openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let url = URLContexts.first?.url {
            handleURL(url: url.absoluteString)
        }

        handledAppOrSceneDelegates = true
    }

    func handleSceneDelegate(continue userActivity: NSUserActivity) {
        if let url = userActivity.webpageURL {
            handleURL(url: url.absoluteString)
        }

        handledAppOrSceneDelegates = true
    }

    @available(iOS 13.0, *)
    func handleSceneDelegate(connectionOptions: UIScene.ConnectionOptions) {
        if let url = connectionOptions.urlContexts.first?.url {
            handleURL(url: url.absoluteString)
        }

        if let url = connectionOptions.userActivities.first?.webpageURL {
            handleURL(url: url.absoluteString)
        }

        handledAppOrSceneDelegates = true
    }
}

extension SuperBoardManager {

    func handleAppDelegate(continue userActivity: NSUserActivity,
                           restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {

        if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let url = userActivity.webpageURL {
            handleURL(url: url.absoluteString)
            handledAppOrSceneDelegates = true

            return true
        }

        handledAppOrSceneDelegates = true
        return false
    }

    func handleAppDelegate(open url: URL, options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
        handleURL(url: url.absoluteString)
        handledAppOrSceneDelegates = true

        return true
    }
}

extension SuperBoardManager {

    func checkIfURISchemeProperlySet(uriScheme: String) {
        guard let urlTypes = Bundle.main.infoDictionary?["CFBundleURLTypes"] as? [[String: Any]] else {
            return
        }

        let parsedSchema = uriScheme.replacingOccurrences(of: "://", with: "")

        for urlType in urlTypes {
            if let role = urlType["CFBundleTypeRole"] as? String, let schemes = urlType["CFBundleURLSchemes"] as? [String], role == "Editor" {
                if schemes.contains(parsedSchema) {
                    DebugLogger.shared.log(.info, "URL Scheme properly configured.")
                    return
                }
            }
        }

        DebugLogger.shared.log(.error, "There's a mismatch between the URL Scheme in the project and the one from the dashboard, deeplinking won't function properly!")
    }
}

extension SuperBoardManager {
    func logInAppPurchase(transactionID: UInt64, completion: @escaping SuperBoardBoolCompletion) {
        guard authenticated else {
            let action = SuperBoardAction(mainBlock: {
                self.logInAppPurchase(transactionID: transactionID, completion: completion)
            }, failureBlock: {
                completion(false)
            })
            enqueueAction(action)

            return
        }

        paymentEventsHandler.logInAppPurchase(transactionID: transactionID, completion: completion)
    }

    func logCustomPurchase(type: TransactionType, priceInCents: Int, currency: String, productID: String, startDate: Date? = nil, completion: @escaping SuperBoardBoolCompletion) {
        guard authenticated else {
            let action = SuperBoardAction(mainBlock: {
                self.logCustomPurchase(
                    type: type,
                    priceInCents: priceInCents,
                    currency: currency,
                    productID: productID,
                    startDate: startDate,
                    completion: completion
                )
            }, failureBlock: {
                completion(false)
            })
            enqueueAction(action)

            return
        }

        paymentEventsHandler.logCustomPurchase(type: type, priceInCents: priceInCents, currency: currency, productID: productID, startDate: startDate, completion: completion)
    }
}

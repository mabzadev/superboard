import Foundation

public typealias SuperBoardURLClosure = (_ url: URL?) -> Void

public typealias SuperBoardPayloadClosure = (_ dictionary: [String: Any]?) -> Void

public typealias SuperBoardDeviceDataClosureClosure = (_ dictionary: [String: Any]?, _ link: String?, _ tracking: [String: Any]?) -> Void

public typealias SuperBoardPayloadsClosure = (_ array: [[String: Any]]?) -> Void

typealias SuperBoardAuthenticationClosure = (_ success: Bool, _ linksquaredID: String?, _ URIScheme: String?, _ identifier: String?, _ attributes: [String: Any]?) -> Void

typealias SuperBoardNotificationsClosure = (_ notifications: [SuperBoardNotification]?) -> Void

public typealias SuperBoardIntClosure = (_ value: Int?) -> Void

public typealias SuperBoardLinkClosure = (_ dictionary: [String: Any]?) -> Void

protocol APIServiceProtocol: AnyObject {
    func addEvent(event: Event, completion: @escaping SuperBoardBoolCompletion)
    func addPaymentEvent(transactionData: TransactionData, completion: @escaping SuperBoardBoolCompletion)
}

class APIService: BaseService, APIServiceProtocol {

    private struct Constants {
        struct URLs {
            static let apiPath = "/v1"

            static let authenticate = "/data/authenticate"
            static let dataForDevice = "/acquisition/data_for_device"
            static let dataForDeviceAndURL = "/acquisition/data_for_device_and_url"
            static let generateLink = "/acquisition/create_link"
            static let event = "/data/event"
            static let attributes = "/data/visitor_attributes"

            static let notifications = "/communication/notifications_for_device"
            static let numberOfUnreadNotifications = "/communication/number_of_unread_notifications"
            static let markNotificationAsRead = "/communication/mark_notification_as_read"
            static let notificationsToDisplayAutomatically = "/communication/notifications_to_display_automatically"
            static let addPaymentEvent = "/monetization/add_payment_event"
            static let linkDetails = "/acquisition/link_details"
        }

        struct Headers {
            static let SDKVersion = "2.3"

            static let apiKey = "PROJECT-KEY"
            static let identifier = "IDENTIFIER"
            static let platform = "PLATFORM"
            static let linksquaredID = "LINKSQUARED"
            static let SDKVersionKey = "SDK-VERSION"
        }
    }

    private let baseURL: URL
    private let apiKey: String
    private let bundleID: String
    private var accessKey: String {
        get {
            if useTestEnvironment {
                return "test_" + apiKey
            }

            return apiKey
        }
    }

    private var useTestEnvironment = false

    private var fetchPayloadDetailsTask: URLSessionTask?
    private var fetchPayloadForURLDetailsTask: URLSessionTask?

    init(apiKey: String, bundleID: String, useTestEnvironment: Bool, baseURL: String? = nil) {
        guard let baseURL, !baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            preconditionFailure("SuperBoard baseURL must be configured by the application")
        }
        let domain = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        let endpoint = domain + Constants.URLs.apiPath
        guard let url = URL(string: endpoint) else {
            preconditionFailure("Invalid API endpoint URL: \(endpoint)")
        }
        self.baseURL = url
        self.apiKey = apiKey
        self.bundleID = bundleID
        self.useTestEnvironment = useTestEnvironment
    }

    func payloadFor(appDetails: AppDetails, url: String, completion: @escaping SuperBoardDeviceDataClosureClosure) {
        guard var request = urlRequestWithAuthHeaders(
            path: Constants.URLs.dataForDeviceAndURL) else {
            completion(nil, nil, nil)
            return
        }
        request.httpMethod = "POST"

        var body = appDetails.toBackend()
        body["url"] = url

        request.httpBody = body.dictToData()

        fetchPayloadForURLDetailsTask?.cancel()
        fetchPayloadDetailsTask?.cancel()

        DebugLogger.shared.log(.info, "Fetching payload for device and URL")
        fetchPayloadForURLDetailsTask = makeRequest(URLRequest: request) { success, json in
            guard let json = json, success else {
                DebugLogger.shared.log(.info, "Fetching payload for device and URL - No payload")
                completion(nil, nil, nil)
                return
            }

            let data = json["data"] as? [String: Any]
            let link = json["link"] as? String
            let tracking = json["tracking"] as? [String: Any]

            DebugLogger.shared.log(.info, "Fetching payload for device and URL - Received payload")
            completion(data, link, tracking)
        }
    }

    func payloadFor(appDetails: AppDetails, completion: @escaping SuperBoardDeviceDataClosureClosure) {
        guard var request = urlRequestWithAuthHeaders(
            path: Constants.URLs.dataForDevice) else {
            completion(nil, nil, nil)
            return
        }
        request.httpMethod = "POST"
        request.httpBody = appDetails.toBackend().dictToData()

        DebugLogger.shared.log(.info, "Fetching payload for device")
        fetchPayloadDetailsTask?.cancel()
        fetchPayloadDetailsTask = makeRequest(URLRequest: request) { success, json in
            guard let json = json, success else {
                DebugLogger.shared.log(.info, "Fetching payload for device - No payload")
                completion(nil, nil, nil)
                return
            }

            let data = json["data"] as? [String: Any]
            let link = json["link"] as? String
            let tracking = json["tracking"] as? [String: Any]

            DebugLogger.shared.log(.info, "Fetching payload for device - Received payload")
            completion(data, link, tracking)
        }
    }

    func generateLink(title: String?,
                      subtitle: String?,
                      imageURL: String?,
                      data: String?,
                      tags: String?,
                      customRedirects: CustomRedirects?,
                      showPreviewiOS: Bool?,
                      showPreviewAndroid: Bool?,
                      trackingCampaign: String? = nil,
                      trackingSource: String? = nil,
                      trackingMedium: String? = nil,
                      completion: @escaping SuperBoardURLClosure) {

        guard var request = urlRequestWithAuthHeaders(path: Constants.URLs.generateLink) else {
            completion(nil)
            return
        }
        request.httpMethod = "POST"
        let body = ["title": title,
                    "subtitle": subtitle,
                    "image_url": imageURL,
                    "data": data,
                    "tags": tags,
                    "ios_custom_redirect": customRedirects?.ios?.toBackend(),
                    "android_custom_redirect": customRedirects?.android?.toBackend(),
                    "desktop_custom_redirect": customRedirects?.desktop?.toBackend(),
                    "show_preview_ios": showPreviewiOS,
                    "show_preview_android": showPreviewAndroid,
                    "tracking_campaign": trackingCampaign,
                    "tracking_source": trackingSource,
                    "tracking_medium": trackingMedium] as [String: Any?]
        request.httpBody = body.dictToData()

        DebugLogger.shared.log(.info, "Generating link")
        makeRequest(URLRequest: request) { success, json in
            guard let json = json, success, let link = json["link"] as? String, let url = URL(string: link) else {
                DebugLogger.shared.log(.error, "Generating link FAILED")
                completion(nil)
                return
            }

            DebugLogger.shared.log(.info, "Generating link \(url.absoluteString)")
            completion(url)
        }
    }

    func authenticate(appDetails: AppDetails, completion: @escaping SuperBoardAuthenticationClosure) {
        guard var request = urlRequestWithAuthHeaders(
            path: Constants.URLs.authenticate) else {
            completion(false, nil, nil, nil, nil)
            return
        }
        request.httpMethod = "POST"
        request.httpBody = appDetails.toBackend().dictToData()

        DebugLogger.shared.log(.info, "Authenticate")
        makeRequest(URLRequest: request) { success, json in
            guard let json = json, success,
                    let id = json["linksquared"] as? String,
                    let uriScheme = json["uri_scheme"] as? String else {

                DebugLogger.shared.log(.info, "Authenticate - No payload")
                completion(false, nil, nil, nil, nil)
                return
            }

            let identifier = json["sdk_identifier"] as? String
            let attributes = json["sdk_attributes"] as? [String: Any]

            DebugLogger.shared.log(.info, "Authenticate - Received payload")
            completion(true, id, uriScheme, identifier, attributes)
        }
    }

    func addEvent(event: Event, completion: @escaping SuperBoardBoolCompletion) {
        guard var request = urlRequestWithAuthHeaders(path: Constants.URLs.event) else {
            completion(false)
            return
        }
        request.httpMethod = "POST"
        request.httpBody = event.toBackend().dictToData()

        DebugLogger.shared.log(.info, "Add event - \(event.type.rawValue)")
        makeRequest(URLRequest: request) { success, json in
            guard json != nil, success else {
                DebugLogger.shared.log(.info, "Add event - Failed - \(event.type.rawValue)")
                completion(false)
                return
            }

            DebugLogger.shared.log(.info, "Add event - Successful - \(event.type.rawValue)")
            completion(true)
        }
    }

    func updateAttributes(completion: @escaping SuperBoardBoolCompletion) {
        guard var request = urlRequestWithAuthHeaders(path: Constants.URLs.attributes) else {
            completion(false)
            return
        }
        request.httpMethod = "POST"
        let body = ["sdk_identifier": Context.identifier as Any,
                    "sdk_attributes": Context.attributes as Any,
                    "push_token": Context.pushToken as Any]
        request.httpBody = body.dictToData()

        DebugLogger.shared.log(.info, "Set attributes")
        makeRequest(URLRequest: request) { success, json in
            guard json != nil, success else {
                DebugLogger.shared.log(.info, "Set attributes - Failed")
                completion(false)
                return
            }

            DebugLogger.shared.log(.info, "Set attributes - Successful")
            completion(true)
        }
    }

    func notifications(page: Int, completion: @escaping SuperBoardNotificationsClosure) {
        guard var request = urlRequestWithAuthHeaders(
            path: Constants.URLs.notifications) else {
            completion(nil)
            return
        }
        request.httpMethod = "POST"
        request.httpBody = ["page": page].dictToData()

        DebugLogger.shared.log(.info, "Get messages")
        makeRequest(URLRequest: request) { success, json in
            guard let jsonDict = json, let jsonData = self.jsonDataFromDictionary(jsonDict), success else {
                DebugLogger.shared.log(.info, "Get messages - Failed")
                completion(nil)
                return
            }

            do {
                let response = try SuperBoardNotification.backendDecoder()
                    .decode(SuperBoardNotificationsResponse.self, from: jsonData)

                DebugLogger.shared.log(.info, "Get messages - Successful")
                completion(response.notifications)
            } catch {
                DebugLogger.shared.log(.info, "Get messages - Failed")
                completion(nil)
            }
        }
    }

    func numberOfUnreadNotifications(completion: @escaping SuperBoardIntClosure) {
        guard var request = urlRequestWithAuthHeaders(
            path: Constants.URLs.numberOfUnreadNotifications) else {
            completion(nil)
            return
        }
        request.httpMethod = "GET"

        DebugLogger.shared.log(.info, "Get unread messages")
        makeRequest(URLRequest: request) { success, json in
            guard let jsonDict = json, let value = jsonDict["number_of_unread_notifications"] as? Int, success else {
                DebugLogger.shared.log(.info, "Get unread messages - Failed")
                completion(nil)
                return
            }

            DebugLogger.shared.log(.info, "Get unread messages - Success")
            completion(value)
        }
    }

    func markNotificationAsRead(notificationID: Int, completion: @escaping SuperBoardBoolCompletion) {
        guard var request = urlRequestWithAuthHeaders(
            path: Constants.URLs.markNotificationAsRead) else {
            completion(false)
            return
        }
        request.httpMethod = "POST"
        request.httpBody = ["id": notificationID].dictToData()

        DebugLogger.shared.log(.info, "Mark notification as read")
        makeRequest(URLRequest: request) { success, json in
            guard success else {
                DebugLogger.shared.log(.info, "Mark notification as read - Failed")
                completion(false)
                return
            }

            DebugLogger.shared.log(.info, "Mark notification as read - Success")
            completion(true)
        }
    }

    func notificationsToDisplayAutomatically(completion: @escaping SuperBoardNotificationsClosure) {
        guard var request = urlRequestWithAuthHeaders(
            path: Constants.URLs.notificationsToDisplayAutomatically) else {
            completion(nil)
            return
        }
        request.httpMethod = "GET"

        DebugLogger.shared.log(.info, "Notifications to display automatically")
        makeRequest(URLRequest: request) { success, json in
            guard let jsonDict = json, let jsonData = self.jsonDataFromDictionary(jsonDict), success else {
                DebugLogger.shared.log(.info, "Notifications to display automatically - Failed")
                completion(nil)
                return
            }

            do {
                let response = try SuperBoardNotification.backendDecoder()
                    .decode(SuperBoardNotificationsResponse.self, from: jsonData)

                DebugLogger.shared.log(.info, "Notifications to display automatically - Successful")
                completion(response.notifications)
            } catch {
                DebugLogger.shared.log(.info, "Notifications to display automatically - Failed")
                completion(nil)
            }
        }
    }

    func addPaymentEvent(transactionData: TransactionData, completion: @escaping SuperBoardBoolCompletion) {
        guard var request = urlRequestWithAuthHeaders(path: Constants.URLs.addPaymentEvent) else {
            completion(false)
            return
        }
        request.httpMethod = "POST"
        request.httpBody = transactionData.toData().dictToData()

        DebugLogger.shared.log(.info, "Add payment event")
        makeRequest(URLRequest: request) { success, json in
            guard success else {
                DebugLogger.shared.log(.error, "Add payment event - Failed")
                completion(false)
                return
            }

            DebugLogger.shared.log(.info, "Add payment event - Success")
            completion(true)
        }
    }

    func linkDetails(path: String, completion: @escaping SuperBoardLinkClosure) {
        guard var request = urlRequestWithAuthHeaders(
            path: Constants.URLs.linkDetails) else {
            completion(nil)
            return
        }
        request.httpMethod = "POST"
        request.httpBody = ["path": path].dictToData()

        DebugLogger.shared.log(.info, "Link details")
        makeRequest(URLRequest: request) { success, json in
            guard let jsonDict = json, success else {
                DebugLogger.shared.log(.info, "Link details - Failed")
                completion(nil)
                return
            }

            DebugLogger.shared.log(.info, "Link details - Successful")
            completion(jsonDict)
        }
    }

    private func jsonDataFromDictionary(_ dict: [String: Any]) -> Data? {
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: dict, options: [])
            return jsonData
        } catch {
            DebugLogger.shared.log(.error, "Error serializing JSON: \(error)")
            return nil
        }
    }

    private func urlRequestWithAuthHeaders(path: String) -> URLRequest? {
        guard let url = URL(string: baseURL.absoluteString + path) else {
            DebugLogger.shared.log(.error, "Invalid API URL path: \(path)")
            return nil
        }

        var request = URLRequest(url: url)
        request.setValue(accessKey, forHTTPHeaderField: Constants.Headers.apiKey)
        request.setValue(bundleID, forHTTPHeaderField: Constants.Headers.identifier)
        request.setValue("ios", forHTTPHeaderField: Constants.Headers.platform)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Constants.Headers.SDKVersion, forHTTPHeaderField: Constants.Headers.SDKVersionKey)
        if let userAgent = Context.userAgent {
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        }

        if let id = Context.linksquaredID {
            request.setValue(id, forHTTPHeaderField: Constants.Headers.linksquaredID)
        }

        return request
    }

}

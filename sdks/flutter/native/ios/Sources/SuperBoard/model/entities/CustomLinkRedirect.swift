import UIKit

public struct CustomLinkRedirect: Codable {
    public let link: String
    public var openAppIfInstalled: Bool = true
    
    public init(link: String, openAppIfInstalled: Bool = true) {
        self.link = link
        self.openAppIfInstalled = openAppIfInstalled
    }
    
    func toBackend() -> [String: Any] {
        return [
            "url": link,
            "open_app_if_installed": openAppIfInstalled
        ]
    }
}

public struct CustomRedirects: Codable {
    public var ios: CustomLinkRedirect? = nil
    public var android: CustomLinkRedirect? = nil
    public var desktop: CustomLinkRedirect? = nil
    
    public init(ios: CustomLinkRedirect? = nil, android: CustomLinkRedirect? = nil, desktop: CustomLinkRedirect? = nil) {
        self.ios = ios
        self.android = android
        self.desktop = desktop
    }
}

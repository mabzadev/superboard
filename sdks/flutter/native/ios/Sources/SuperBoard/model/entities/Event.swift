import Foundation

enum EventType: String {
    case appOpen = "app_open"
    case view = "view"
    case open = "open"
    case install = "install"
    case reinstall = "reinstall"
    case timeSpent = "time_spent"
    case reactivation = "reactivation"
}

class Event: NSObject, NSSecureCoding {

    static var supportsSecureCoding: Bool { true }

    let id: UUID

    let type: EventType

    let createdAt: Date

    var link: String?

    var engagementTime: Int?

    init(type: EventType, createdAt: Date, link: String? = nil, engagementTime: Int? = nil) {
        self.id = UUID()
        self.type = type
        self.createdAt = createdAt
        self.link = link
        self.engagementTime = engagementTime
    }

    func encode(with coder: NSCoder) {
        coder.encode(id.uuidString, forKey: "id")
        coder.encode(type.rawValue, forKey: "type")
        coder.encode(createdAt, forKey: "createdAt")
        coder.encode(link, forKey: "link")
        coder.encode(engagementTime, forKey: "engagementTime")
    }

    required init?(coder: NSCoder) {
        guard let typeRawValue = coder.decodeObject(of: NSString.self, forKey: "type") as String?,
              let type = EventType(rawValue: typeRawValue),
              let createdAt = coder.decodeObject(of: NSDate.self, forKey: "createdAt") as Date?
        else {
            return nil
        }

        if let idString = coder.decodeObject(of: NSString.self, forKey: "id") as String?,
           let id = UUID(uuidString: idString) {
            self.id = id
        } else {
            self.id = UUID()
        }
        self.type = type
        self.createdAt = createdAt
        self.link = coder.decodeObject(of: NSString.self, forKey: "link") as String?
        self.engagementTime = coder.decodeObject(of: NSNumber.self, forKey: "engagementTime") as? Int
    }

    func toBackend() -> [String: Any] {
        return ["event": type.rawValue, "link": link as Any, "engagement_time": engagementTime as Any, "created_at": createdAt.backendDateString()]
    }
}

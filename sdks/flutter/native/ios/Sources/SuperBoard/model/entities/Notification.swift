import Foundation

struct SuperBoardNotification: Codable {
    let id: Int
    let title: String
    let updatedAt: Date
    let subtitle: String?
    let autoDisplay: Bool
    let accessURL: URL?
    let read: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case updatedAt = "updated_at"
        case subtitle
        case autoDisplay = "auto_display"
        case accessURL = "access_url"
        case read
    }
}

extension SuperBoardNotification {
    static func backendDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .formatted(Date.backendDateFormatter())
        return decoder
    }

    static func backendEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .formatted(Date.backendDateFormatter())
        return encoder
    }
}

struct SuperBoardNotificationsResponse: Codable {
    let notifications: [SuperBoardNotification]
}

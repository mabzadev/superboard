import Foundation

extension Date {

    private static let _backendDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        return formatter
    }()

    private static let _dateOnlyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    func toSeconds() -> Int {
        return Int(self.timeIntervalSince1970)
    }

    static func fromSeconds(_ seconds: Int) -> Date {
        return Date(timeIntervalSince1970: TimeInterval(seconds))
    }

    func daysBetween(_ date: Date) -> Int? {
        let calendar = Calendar.current
        let startOfSelf = calendar.startOfDay(for: self)
        let startOfOtherDate = calendar.startOfDay(for: date)
        let components = calendar.dateComponents([.day], from: startOfSelf, to: startOfOtherDate)
        return components.day
    }

    static func dateOnlyFromBackend(string: String) -> Date? {
        return _dateOnlyFormatter.date(from: string)
    }

    func backendDateString() -> String {
        return Date._backendDateFormatter.string(from: self)
    }

    static func backendDateFormatter() -> DateFormatter {
        return _backendDateFormatter
    }
}

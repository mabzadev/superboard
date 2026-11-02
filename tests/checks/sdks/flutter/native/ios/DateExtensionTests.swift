import XCTest
@testable import SuperBoard

final class DateExtensionTests: XCTestCase {

    func testToSecondsAndFromSecondsRoundTrip() {
        let original = Date()
        let seconds = original.toSeconds()
        let reconstructed = Date.fromSeconds(seconds)

        XCTAssertEqual(reconstructed.timeIntervalSince1970,
                       Double(seconds), accuracy: 0.001)
    }

    func testDaysBetweenSameDateIsZero() {
        let date = Date()
        XCTAssertEqual(date.daysBetween(date), 0)
    }

    func testDaysBetweenUsesStartOfDay() {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let lateToday = startOfToday.addingTimeInterval(23 * 3600 + 59 * 60)

        XCTAssertEqual(startOfToday.daysBetween(lateToday), 0,
                       "Same calendar day should return 0 regardless of time")
    }

    func testDaysBetweenCrossingMidnight() {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let yesterday = calendar.date(byAdding: .day, value: -1, to: startOfToday)!

        XCTAssertEqual(yesterday.daysBetween(startOfToday), 1)
    }

    func testDaysBetweenSevenDays() {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let sevenDaysAgo = calendar.date(byAdding: .day, value: -7, to: startOfToday)!

        XCTAssertEqual(sevenDaysAgo.daysBetween(startOfToday), 7)
    }

    func testDaysBetweenIsDirectional() {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let threeDaysAgo = calendar.date(byAdding: .day, value: -3, to: startOfToday)!

        XCTAssertEqual(threeDaysAgo.daysBetween(startOfToday), 3)
        XCTAssertEqual(startOfToday.daysBetween(threeDaysAgo), -3)
    }

    func testBackendDateStringFormat() {
        let date = Date(timeIntervalSince1970: 0)
        let result = date.backendDateString()

        let regex = #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$"#
        XCTAssertTrue(result.range(of: regex, options: .regularExpression) != nil,
                      "backendDateString '\(result)' should match ISO 8601 with millis format")
    }

    func testBackendDateStringRoundTripThroughFormatter() throws {
        let original = Date()
        let string = original.backendDateString()
        let formatter = Date.backendDateFormatter()
        let parsed = try XCTUnwrap(formatter.date(from: string),
                                   "backendDateString output should be parseable by backendDateFormatter")

        XCTAssertEqual(parsed.timeIntervalSince1970, original.timeIntervalSince1970, accuracy: 0.001)
    }

    func testDateOnlyFromBackendParsesValidDate() {
        let date = Date.dateOnlyFromBackend(string: "2024-06-15")
        XCTAssertNotNil(date)

        let calendar = Calendar.current
        let components = calendar.dateComponents([.year, .month, .day], from: date!)
        XCTAssertEqual(components.year, 2024)
        XCTAssertEqual(components.month, 6)
        XCTAssertEqual(components.day, 15)
    }

    func testDateOnlyFromBackendReturnsNilForInvalidString() {
        XCTAssertNil(Date.dateOnlyFromBackend(string: "not-a-date"))
        XCTAssertNil(Date.dateOnlyFromBackend(string: ""))
        XCTAssertNil(Date.dateOnlyFromBackend(string: "15/06/2024"))
    }

    func testBackendDateFormatterUsesPOSIXLocale() {
        let formatter = Date.backendDateFormatter()
        XCTAssertEqual(formatter.locale.identifier, "en_US_POSIX")
    }
}

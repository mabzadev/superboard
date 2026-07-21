import XCTest
@testable import OpenGrow

final class UserDefaultsHelperTests: XCTestCase {

    override func setUp() {
        super.setUp()
        for key in [UserDefaultsKeys.opengrowNumberOfOpens, .opengrowResignTimestamp, .opengrowLastStartTimestamp] {
            UserDefaultsHelper.remove(key: key)
        }
    }

    override func tearDown() {
        for key in [UserDefaultsKeys.opengrowNumberOfOpens, .opengrowResignTimestamp, .opengrowLastStartTimestamp] {
            UserDefaultsHelper.remove(key: key)
        }
        super.tearDown()
    }

    // MARK: - Raw value stability
    // If someone renames these raw values, all persisted user data silently breaks.

    func testRawValuesAreStable() {
        XCTAssertEqual(UserDefaultsKeys.opengrowNumberOfOpens.rawValue, "opengrowNumberOfOpens")
        XCTAssertEqual(UserDefaultsKeys.opengrowResignTimestamp.rawValue, "opengrowResignTimestamp")
        XCTAssertEqual(UserDefaultsKeys.opengrowLastStartTimestamp.rawValue, "opengrowLastStartTimestamp")
    }

    // MARK: - Protocol conformance (instance delegates to static)
    // UserDefaultsHelper conforms to UserDefaultsHelperProtocol via instance methods
    // that call static methods. This is actual logic worth verifying.

    func testInstanceGetIntDelegatesToStatic() {
        UserDefaultsHelper.set(value: 77, key: .opengrowNumberOfOpens)
        let helper = UserDefaultsHelper()
        let result = helper.getInt(key: .opengrowNumberOfOpens)
        XCTAssertEqual(result, 77, "Instance getInt should read the same value written by static set")
    }

    func testInstanceSetIntDelegatesToStatic() {
        let helper = UserDefaultsHelper()
        helper.setInt(value: 88, key: .opengrowNumberOfOpens)
        let result = UserDefaultsHelper.getInt(key: .opengrowNumberOfOpens)
        XCTAssertEqual(result, 88, "Static getInt should read the value written by instance setInt")
    }

    // MARK: - containsItem vs remove interaction

    func testContainsItemReturnsFalseAfterRemove() {
        UserDefaultsHelper.set(value: 1, key: .opengrowResignTimestamp)
        XCTAssertTrue(UserDefaultsHelper.containsItem(for: .opengrowResignTimestamp))
        UserDefaultsHelper.remove(key: .opengrowResignTimestamp)
        XCTAssertFalse(UserDefaultsHelper.containsItem(for: .opengrowResignTimestamp),
                       "containsItem should return false after remove")
    }
}

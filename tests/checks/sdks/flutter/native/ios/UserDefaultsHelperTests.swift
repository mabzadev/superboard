import XCTest
@testable import SuperBoard

final class UserDefaultsHelperTests: XCTestCase {

    override func setUp() {
        super.setUp()
        for key in [UserDefaultsKeys.superboardNumberOfOpens, .superboardResignTimestamp, .superboardLastStartTimestamp] {
            UserDefaultsHelper.remove(key: key)
        }
    }

    override func tearDown() {
        for key in [UserDefaultsKeys.superboardNumberOfOpens, .superboardResignTimestamp, .superboardLastStartTimestamp] {
            UserDefaultsHelper.remove(key: key)
        }
        super.tearDown()
    }

    func testRawValuesAreStable() {
        XCTAssertEqual(UserDefaultsKeys.superboardNumberOfOpens.rawValue, "superboardNumberOfOpens")
        XCTAssertEqual(UserDefaultsKeys.superboardResignTimestamp.rawValue, "superboardResignTimestamp")
        XCTAssertEqual(UserDefaultsKeys.superboardLastStartTimestamp.rawValue, "superboardLastStartTimestamp")
    }

    func testInstanceGetIntDelegatesToStatic() {
        UserDefaultsHelper.set(value: 77, key: .superboardNumberOfOpens)
        let helper = UserDefaultsHelper()
        let result = helper.getInt(key: .superboardNumberOfOpens)
        XCTAssertEqual(result, 77, "Instance getInt should read the same value written by static set")
    }

    func testInstanceSetIntDelegatesToStatic() {
        let helper = UserDefaultsHelper()
        helper.setInt(value: 88, key: .superboardNumberOfOpens)
        let result = UserDefaultsHelper.getInt(key: .superboardNumberOfOpens)
        XCTAssertEqual(result, 88, "Static getInt should read the value written by instance setInt")
    }

    func testContainsItemReturnsFalseAfterRemove() {
        UserDefaultsHelper.set(value: 1, key: .superboardResignTimestamp)
        XCTAssertTrue(UserDefaultsHelper.containsItem(for: .superboardResignTimestamp))
        UserDefaultsHelper.remove(key: .superboardResignTimestamp)
        XCTAssertFalse(UserDefaultsHelper.containsItem(for: .superboardResignTimestamp),
                       "containsItem should return false after remove")
    }
}

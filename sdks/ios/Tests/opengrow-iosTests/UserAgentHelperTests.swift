import XCTest
@testable import OpenGrow

final class UserAgentHelperTests: XCTestCase {
    func testApplicationUserAgentIsStableAndDoesNotRequireWebKit() {
        let first = UserAgentHelper.applicationUserAgent()
        let second = UserAgentHelper.applicationUserAgent()

        XCTAssertEqual(first, second)
        XCTAssertTrue(first.contains("OpenGrow-iOS"))
        XCTAssertFalse(first.isEmpty)
    }

    func testAsyncContractCompletesImmediatelyWithApplicationUserAgent() {
        let expectation = expectation(description: "user agent")

        UserAgentHelper.getApplicationUserAgent { userAgent in
            XCTAssertEqual(userAgent, UserAgentHelper.applicationUserAgent())
            expectation.fulfill()
        }

        wait(for: [expectation], timeout: 1)
    }
}

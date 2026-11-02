import XCTest
@testable import SuperBoard

final class SuperBoardPublicAPITests: XCTestCase {

    private let baseURL = "https://sdk.example.com"

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
        BaseService.urlProtocolClasses = [MockURLProtocol.self]
        Context.reset()
    }

    override func tearDown() {
        BaseService.urlProtocolClasses = []
        MockURLProtocol.reset()
        Context.reset()
        super.tearDown()
    }

    func testDelegateIsNilBeforeConfigure() {
        XCTAssertNil(SuperBoard.delegate)
    }

    func testSetUserIdentifierDoesNotCrashBeforeConfigure() {
        SuperBoard.userIdentifier = "test-id"
        XCTAssertNil(SuperBoard.userIdentifier)
    }

    func testGenerateLinkReturnsNilBeforeConfigure() {
        let setupExp = expectation(description: "setup")
        SuperBoard.configure(APIKey: "", useTestEnvironment: true, baseURL: baseURL, delegate: nil) { _ in
            setupExp.fulfill()
        }
        wait(for: [setupExp], timeout: 5)

        let exp = expectation(description: "completion called")
        SuperBoard.generateLink(title: "Test") { url in
            XCTAssertNil(url, "Should return nil when SDK is not configured")
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    func testConfigureWithEmptyKeyCallsCompletionFalse() {
        let exp = expectation(description: "completion")
        SuperBoard.configure(APIKey: "", useTestEnvironment: true, baseURL: baseURL, delegate: nil) { success in
            XCTAssertFalse(success, "Empty API key should fail configuration")
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    func testConfigureWithValidKeyTriggersAuthentication() {
        let exp = expectation(description: "completion")
        SuperBoard.configure(APIKey: "test-key", useTestEnvironment: true, baseURL: baseURL, delegate: nil) { success in
            XCTAssertFalse(success, "Auth should fail without URI schemes in test bundle")
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    func testAllReceivedPayloadsBeforeConfigureReturnsNil() {
        let setupExp = expectation(description: "setup")
        SuperBoard.configure(APIKey: "", useTestEnvironment: true, baseURL: baseURL, delegate: nil) { _ in
            setupExp.fulfill()
        }
        wait(for: [setupExp], timeout: 5)

        let exp = expectation(description: "payloads")
        SuperBoard.allReceivedPayloadsSinceStartup { payloads in
            XCTAssertNil(payloads)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    func testLogInAppPurchaseBeforeConfigureReturnsFalse() {
        let setupExp = expectation(description: "setup")
        SuperBoard.configure(APIKey: "", useTestEnvironment: true, baseURL: baseURL, delegate: nil) { _ in
            setupExp.fulfill()
        }
        wait(for: [setupExp], timeout: 5)

        let exp = expectation(description: "purchase")
        SuperBoard.logInAppPurchase(transactionID: 123) { success in
            XCTAssertFalse(success)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    func testLogCustomPurchaseBeforeConfigureReturnsFalse() {
        let setupExp = expectation(description: "setup")
        SuperBoard.configure(APIKey: "", useTestEnvironment: true, baseURL: baseURL, delegate: nil) { _ in
            setupExp.fulfill()
        }
        wait(for: [setupExp], timeout: 5)

        let exp = expectation(description: "custom purchase")
        SuperBoard.logCustomPurchase(type: .buy, priceInCents: 100, currency: "USD", productID: "test") { success in
            XCTAssertFalse(success)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    func testSetDebugLevelChangesLogLevel() {
        let original = DebugLogger.shared.logLevel
        defer { DebugLogger.shared.logLevel = original }

        SuperBoard.setDebug(level: .info)
        XCTAssertEqual(DebugLogger.shared.logLevel, .info)

        SuperBoard.setDebug(level: .error)
        XCTAssertEqual(DebugLogger.shared.logLevel, .error)
    }
}

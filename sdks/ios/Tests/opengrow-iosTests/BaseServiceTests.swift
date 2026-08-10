import XCTest
@testable import OpenGrow

final class BaseServiceTests: XCTestCase {

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
        BaseService.urlProtocolClasses = [MockURLProtocol.self]
    }

    override func tearDown() {
        BaseService.urlProtocolClasses = []
        MockURLProtocol.reset()
        super.tearDown()
    }

    // MARK: - Single background request

    func testSingleBackgroundRequestCallsCompletion() {
        let service = BaseService()
        let url = URL(string: "https://example.com/bg1")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        MockURLProtocol.requestHandlers["/bg1"] = { _ in
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try JSONSerialization.data(withJSONObject: ["result": "ok"])
            return (response, data)
        }

        let exp = expectation(description: "background request completes")
        service.makeRequest(background: true, URLRequest: request) { success, json in
            XCTAssertTrue(success)
            XCTAssertEqual(json?["result"] as? String, "ok")
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    // MARK: - Concurrent background requests

    func testConcurrentBackgroundRequestsBothComplete() {
        let service = BaseService()

        let url1 = URL(string: "https://example.com/first")!
        var request1 = URLRequest(url: url1)
        request1.httpMethod = "GET"

        let url2 = URL(string: "https://example.com/second")!
        var request2 = URLRequest(url: url2)
        request2.httpMethod = "GET"

        MockURLProtocol.requestHandlers["/first"] = { _ in
            let response = HTTPURLResponse(url: url1, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try JSONSerialization.data(withJSONObject: ["id": "first"])
            return (response, data)
        }

        MockURLProtocol.requestHandlers["/second"] = { _ in
            let response = HTTPURLResponse(url: url2, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try JSONSerialization.data(withJSONObject: ["id": "second"])
            return (response, data)
        }

        let exp1 = expectation(description: "first background request")
        let exp2 = expectation(description: "second background request")

        service.makeRequest(background: true, URLRequest: request1) { success, json in
            XCTAssertTrue(success)
            XCTAssertEqual(json?["id"] as? String, "first")
            exp1.fulfill()
        }

        service.makeRequest(background: true, URLRequest: request2) { success, json in
            XCTAssertTrue(success)
            XCTAssertEqual(json?["id"] as? String, "second")
            exp2.fulfill()
        }

        wait(for: [exp1, exp2], timeout: 5)
    }

    // MARK: - Background request error

    func testBackgroundRequestErrorCallsCompletionWithFalse() {
        let service = BaseService()
        let url = URL(string: "https://example.com/fail")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        MockURLProtocol.requestHandlers["/fail"] = { _ in
            throw URLError(.badServerResponse)
        }

        let exp = expectation(description: "error completion")
        service.makeRequest(background: true, URLRequest: request) { success, json in
            XCTAssertFalse(success)
            XCTAssertNil(json)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    // MARK: - Foreground request tests

    func testForegroundRequestSuccessReturnsJSON() {
        let service = BaseService()
        let url = URL(string: "https://example.com/fg1")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        MockURLProtocol.requestHandlers["/fg1"] = { _ in
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try JSONSerialization.data(withJSONObject: ["key": "value"])
            return (response, data)
        }

        let exp = expectation(description: "foreground success")
        service.makeRequest(background: false, URLRequest: request) { success, json in
            XCTAssertTrue(success)
            XCTAssertEqual(json?["key"] as? String, "value")
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    func testForegroundRequestNon200ReturnsFailureWithJSON() {
        let service = BaseService()
        let url = URL(string: "https://example.com/fg500")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        MockURLProtocol.requestHandlers["/fg500"] = { _ in
            let response = HTTPURLResponse(url: url, statusCode: 500, httpVersion: nil, headerFields: nil)!
            let data = try JSONSerialization.data(withJSONObject: ["error": "internal"])
            return (response, data)
        }

        let exp = expectation(description: "foreground 500")
        service.makeRequest(background: false, URLRequest: request) { success, json in
            XCTAssertFalse(success, "Non-200 status should return success=false")
            XCTAssertEqual(json?["error"] as? String, "internal",
                           "JSON body should still be provided on non-200")
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    func testForegroundRequestInvalidJSONReturnsFailure() {
        let service = BaseService()
        let url = URL(string: "https://example.com/fginvalid")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        MockURLProtocol.requestHandlers["/fginvalid"] = { _ in
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = "not json".data(using: .utf8)!
            return (response, data)
        }

        let exp = expectation(description: "foreground invalid JSON")
        service.makeRequest(background: false, URLRequest: request) { success, json in
            XCTAssertFalse(success, "Invalid JSON should return success=false")
            XCTAssertNil(json, "Invalid JSON should return nil json")
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    func testJSONArrayResponseWrappedInValueKey() {
        let service = BaseService()
        let url = URL(string: "https://example.com/fgarray")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        MockURLProtocol.requestHandlers["/fgarray"] = { _ in
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let data = try JSONSerialization.data(withJSONObject: [["id": 1], ["id": 2]])
            return (response, data)
        }

        let exp = expectation(description: "foreground array response")
        service.makeRequest(background: false, URLRequest: request) { success, json in
            XCTAssertTrue(success)
            let value = json?["value"] as? [[String: Any]]
            XCTAssertEqual(value?.count, 2,
                           "Array response should be wrapped in [\"value\": [...]]")
            XCTAssertEqual(value?.first?["id"] as? Int, 1)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)
    }

    // MARK: - Retry tests

    func testNetworkConnectionLostQueuesAndRetriesOnFlush() {
        assertRetryableTransportError(.networkConnectionLost)
    }

    func testNotConnectedToInternetRetriesAndSucceeds() {
        assertRetryableTransportError(.notConnectedToInternet)
    }

    func testTimedOutRetriesAndSucceeds() {
        assertRetryableTransportError(.timedOut)
    }

    func testRetryableTransportErrorStopsAfterMaximumRetryCount() {
        let url = URL(string: "https://example.com/retry-limit")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        var callCount = 0
        var scheduledRetryCount = 0
        let service = BaseService(
            foregroundRequestExecutor: { _, completion in
                callCount += 1
                completion(nil, nil, URLError(.timedOut))
                return nil
            },
            retryScheduler: { _, operation in
                scheduledRetryCount += 1
                operation()
            }
        )

        let exp = expectation(description: "maximum retry count reached")
        service.makeRequest(background: false, URLRequest: request) { success, json in
            XCTAssertFalse(success)
            XCTAssertNil(json)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 1)

        XCTAssertEqual(callCount, 6, "The initial request plus five retries must execute")
        XCTAssertEqual(scheduledRetryCount, 5, "No retry may be scheduled after the fifth retry")
    }

    private func assertRetryableTransportError(
        _ errorCode: URLError.Code,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let url = URL(string: "https://example.com/retry")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        var callCount = 0
        var scheduledRetryCount = 0
        let service = BaseService(
            foregroundRequestExecutor: { _, completion in
                callCount += 1
                if callCount == 1 {
                    completion(nil, nil, URLError(errorCode))
                    return nil
                }

                let response = HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: nil
                )!
                let data = Data(#"{"retried":true}"#.utf8)
                completion(data, response, nil)
                return nil
            },
            retryScheduler: { delay, operation in
                scheduledRetryCount += 1
                XCTAssertGreaterThanOrEqual(delay, 2, file: file, line: line)
                XCTAssertLessThanOrEqual(delay, 3, file: file, line: line)
                operation()
            }
        )

        let exp = expectation(description: "retry after \(errorCode.rawValue)")
        service.makeRequest(background: false, URLRequest: request) { success, json in
            XCTAssertTrue(success, "Retried request should succeed", file: file, line: line)
            XCTAssertEqual(json?["retried"] as? Bool, true, file: file, line: line)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 1)

        XCTAssertEqual(callCount, 2, "The request must execute once and retry once", file: file, line: line)
        XCTAssertEqual(scheduledRetryCount, 1, "Exactly one retry must be scheduled", file: file, line: line)
    }
}

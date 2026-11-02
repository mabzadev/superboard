import XCTest

extension XCTestCase {

    func waitForMainQueue(timeout: TimeInterval = 5, file: StaticString = #filePath, line: UInt = #line) {
        let exp = expectation(description: "main queue drained")
        DispatchQueue.main.async { exp.fulfill() }
        wait(for: [exp], timeout: timeout)
    }

    func waitForQueue(_ queue: DispatchQueue, timeout: TimeInterval = 5, file: StaticString = #filePath, line: UInt = #line) {
        let exp = expectation(description: "queue drained")
        queue.async { exp.fulfill() }
        wait(for: [exp], timeout: timeout)
    }

    func assertValueIsNil(
        _ dict: [String: Any], key: String,
        file: StaticString = #file, line: UInt = #line
    ) {
        guard let value = dict[key] else {
            XCTFail("Key '\(key)' not found in dictionary", file: file, line: line)
            return
        }
        let mirror = Mirror(reflecting: value)
        let isNil = mirror.displayStyle == .optional && mirror.children.isEmpty
        XCTAssertTrue(isNil,
                      "Value for '\(key)' should be nil, got: \(value)",
                      file: file, line: line)
    }
}

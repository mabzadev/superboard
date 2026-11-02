import Foundation
import XCTest

class MockURLProtocol: URLProtocol {

    private static let stateLock = NSLock()

    private static var storedRequestHandlers: [String: (URLRequest) throws -> (HTTPURLResponse, Data?)] = [:]
    private static var storedRequestedPaths: [String] = []
    private static var storedPathExpectations: [String: XCTestExpectation] = [:]

    static var requestHandlers: [String: (URLRequest) throws -> (HTTPURLResponse, Data?)] {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return storedRequestHandlers
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            storedRequestHandlers = newValue
        }
    }

    static var requestedPaths: [String] {
        stateLock.lock()
        defer { stateLock.unlock() }
        return storedRequestedPaths
    }

    static var pathExpectations: [String: XCTestExpectation] {
        get {
            stateLock.lock()
            defer { stateLock.unlock() }
            return storedPathExpectations
        }
        set {
            stateLock.lock()
            defer { stateLock.unlock() }
            storedPathExpectations = newValue
        }
    }

    static func reset() {
        stateLock.lock()
        defer { stateLock.unlock() }
        storedRequestHandlers.removeAll()
        storedRequestedPaths.removeAll()
        storedPathExpectations.removeAll()
    }

    private static func recordRequest(
        path: String
    ) -> ((URLRequest) throws -> (HTTPURLResponse, Data?))? {
        stateLock.lock()
        let handler = storedRequestHandlers[path]
        let expectation = storedPathExpectations[path]
        if !path.isEmpty {
            storedRequestedPaths.append(path)
        }
        stateLock.unlock()

        expectation?.fulfill()
        return handler
    }

    override class func canInit(with request: URLRequest) -> Bool {
        return true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        return request
    }

    override func startLoading() {
        var capturedRequest = request
        if capturedRequest.httpBody == nil, let stream = capturedRequest.httpBodyStream {
            stream.open()
            var data = Data()
            let bufferSize = 1024
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let bytesRead = stream.read(buffer, maxLength: bufferSize)
                if bytesRead > 0 {
                    data.append(buffer, count: bytesRead)
                }
            }
            stream.close()
            capturedRequest.httpBody = data
        }

        let path = request.url?.path ?? ""
        guard let handler = Self.recordRequest(path: path) else {
            let response = HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
            return
        }

        do {
            let (response, data) = try handler(capturedRequest)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            if let data = data {
                client?.urlProtocol(self, didLoad: data)
            }
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

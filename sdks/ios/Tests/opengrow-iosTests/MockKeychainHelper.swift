import Foundation
@testable import OpenGrow

class MockKeychainHelper: KeychainHelperProtocol {
    var store: [KeychainKeys: String] = [:]

    var getValueCallCount = 0

    func getValue(forKey key: KeychainKeys) -> String? {
        getValueCallCount += 1
        return store[key]
    }

    func reset() {
        store.removeAll()
        getValueCallCount = 0
    }
}

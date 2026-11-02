import XCTest
@testable import SuperBoard

final class DataCacheTests: XCTestCase {

    private var cache: DataCache!
    private var cacheName: String!

    override func setUp() {
        super.setUp()
        cacheName = "test-\(UUID().uuidString)"
        cache = DataCache(name: cacheName)
    }

    override func tearDown() {
        cache.cleanAll()
        let exp = expectation(description: "disk cleanup")
        cache.cleanExpiredDiskCache { exp.fulfill() }
        wait(for: [exp], timeout: 5)
        cache = nil
        super.tearDown()
    }

    func testWriteAndReadDataRoundTrip() {
        let original = "hello world".data(using: .utf8)!
        cache.writeSync(data: original, forKey: "data-key")

        let readBack = cache.readData(forKey: "data-key")
        XCTAssertEqual(readBack, original, "Data read back should equal data written")
    }

    func testWriteAndReadObjectNSCodingRoundTrip() {
        let original: NSString = "NSCoding string value"
        cache.write(object: original, forKey: "nscoding-key")

        waitForQueue(cache.ioQueue)

        let readBack = cache.readObject(forKey: "nscoding-key") as? NSString
        XCTAssertEqual(readBack, original, "NSCoding object should survive write/read cycle")
    }

    func testWriteAndReadCodableRoundTrip() throws {
        struct Item: Codable, Equatable {
            let id: Int
            let name: String
        }

        let original = Item(id: 42, name: "widget")
        try cache.write(codable: original, forKey: "codable-key")

        waitForQueue(cache.ioQueue)

        let readBack: Item? = try cache.readCodable(forKey: "codable-key")
        XCTAssertEqual(readBack, original, "Codable object should survive write/read cycle")
    }

    func testReadNonexistentKeyReturnsNil() {
        let data = cache.readData(forKey: "nonexistent-key-\(UUID().uuidString)")
        XCTAssertNil(data, "Reading a nonexistent key should return nil")
    }

    func testCleanByKeyRemovesOnlyThatKey() {
        let data1 = "one".data(using: .utf8)!
        let data2 = "two".data(using: .utf8)!
        cache.writeSync(data: data1, forKey: "key-1")
        cache.writeSync(data: data2, forKey: "key-2")

        cache.clean(byKey: "key-1")

        waitForQueue(cache.ioQueue)

        XCTAssertFalse(cache.hasData(forKey: "key-1"),
                       "Cleaned key should no longer have data")
        XCTAssertTrue(cache.hasData(forKey: "key-2"),
                      "Other key should survive clean")
    }

    func testReadCorruptedDataFromDiskReturnsNil() {
        let key = "corrupted"
        let filePath = cache.cachePath(forKey: key)
        cache.writeSync(data: "valid".data(using: .utf8)!, forKey: "setup")

        let garbage = Data([0xFF, 0xFE, 0x00, 0xAB, 0xCD])
        FileManager.default.createFile(atPath: filePath, contents: garbage, attributes: nil)
        cache.cleanMemCache()

        let obj = cache.readObject(forKey: key)
        XCTAssertNil(obj, "Corrupted data should return nil from readObject, not crash")
    }

    func testReadTruncatedNSCodingArchiveReturnsNil() throws {
        let key = "truncated"
        let original: NSString = "a valid NSCoding string"
        let validData = try NSKeyedArchiver.archivedData(withRootObject: original, requiringSecureCoding: false)

        let truncated = validData.prefix(validData.count / 2)
        cache.writeSync(data: truncated, forKey: key)
        cache.cleanMemCache()

        let obj = cache.readObject(forKey: key)
        XCTAssertNil(obj, "Truncated NSCoding archive should return nil, not crash")
    }

    func testReadEmptyFileReturnsNilOrEmpty() {
        let key = "empty-file"
        cache.writeSync(data: "valid".data(using: .utf8)!, forKey: "setup")

        let filePath = cache.cachePath(forKey: key)
        FileManager.default.createFile(atPath: filePath, contents: Data(), attributes: nil)
        cache.cleanMemCache()

        let data = cache.readData(forKey: key)
        XCTAssertTrue(data == nil || data?.isEmpty == true,
                      "Empty file should return nil or empty data")
    }

    func testCacheDirectoryDeletedRecreatesOnWrite() {
        try? FileManager.default.removeItem(atPath: cache.cachePath)

        let data = "after-delete".data(using: .utf8)!
        cache.writeSync(data: data, forKey: "recreated")

        let readBack = cache.readData(forKey: "recreated")
        XCTAssertEqual(readBack, data, "Write after directory deletion should succeed")
    }

    func testConcurrentWritesDoNotCrashOrCorrupt() {
        let group = DispatchGroup()
        let iterations = 50

        for i in 0..<iterations {
            group.enter()
            DispatchQueue.global().async {
                let data = "thread-\(i)".data(using: .utf8)!
                self.cache.writeSync(data: data, forKey: "concurrent-\(i)")
                group.leave()
            }
        }

        group.wait()

        for i in 0..<iterations {
            let data = cache.readData(forKey: "concurrent-\(i)")
            XCTAssertNotNil(data, "Entry \(i) should exist after concurrent write")
            XCTAssertEqual(String(data: data!, encoding: .utf8), "thread-\(i)")
        }
    }

    func testConcurrentReadWriteDoesNotCrash() {
        for i in 0..<20 {
            cache.writeSync(data: "seed-\(i)".data(using: .utf8)!, forKey: "rw-\(i)")
        }

        let group = DispatchGroup()

        for i in 0..<20 {
            group.enter()
            DispatchQueue.global().async {
                _ = self.cache.readData(forKey: "rw-\(i)")
                group.leave()
            }
            group.enter()
            DispatchQueue.global().async {
                self.cache.writeSync(data: "updated-\(i)".data(using: .utf8)!, forKey: "rw-\(i)")
                group.leave()
            }
        }

        group.wait()
    }

    func testHasDataReturnsTrueAfterWriteAndFalseAfterClean() {
        let key = "has-data-key"
        XCTAssertFalse(cache.hasData(forKey: key),
                       "hasData should return false before write")

        cache.writeSync(data: "test".data(using: .utf8)!, forKey: key)
        XCTAssertTrue(cache.hasData(forKey: key),
                      "hasData should return true after write")

        cache.clean(byKey: key)

        waitForQueue(cache.ioQueue)

        XCTAssertFalse(cache.hasData(forKey: key),
                       "hasData should return false after clean")
    }
}

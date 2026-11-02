import XCTest
@testable import SuperBoard

final class EventsHandlerTests: XCTestCase {

    private var mockService: MockAPIService!
    private var mockStorage: MockEventsStorage!
    private var mockDefaults: MockUserDefaultsHelper!
    private var mockKeychain: MockKeychainHelper!

    override func setUp() {
        super.setUp()
        mockService = MockAPIService()
        mockStorage = MockEventsStorage()
        mockDefaults = MockUserDefaultsHelper()
        mockKeychain = MockKeychainHelper()
    }

    override func tearDown() {
        mockService = nil
        mockStorage = nil
        mockDefaults = nil
        mockKeychain = nil
        super.tearDown()
    }

    private func makeHandler() -> EventsHandler {
        return EventsHandler(apiService: mockService, storage: mockStorage, userDefaults: mockDefaults, keychain: mockKeychain)
    }

    private func makeCleanHandler() -> EventsHandler {
        let handler = makeHandler()
        mockStorage.events.removeAll()
        mockStorage.addEventCallCount = 0
        mockStorage.addOrReplaceCallCount = 0
        mockStorage.removeEventCallCount = 0
        mockStorage.getEventsCallCount = 0
        mockService.reset()
        mockDefaults.getIntCallCount = 0
        mockDefaults.setIntCallCount = 0
        mockKeychain.getValueCallCount = 0
        return handler
    }

    func testLogEventStoresEventInStorage() {
        let handler = makeHandler()
        let event = Event(type: .view, createdAt: Date())

        handler.log(event: event)

        XCTAssertTrue(mockStorage.events.contains(where: { $0.id == event.id }),
                      "Logged event should be in storage")
    }

    func testLogEventAssignsLinkForFutureActionsWhenLinkIsSet() {
        let handler = makeHandler()

        let exp = expectation(description: "link set")
        handler.setLinkToNewFutureActions(link: "https://test-link.com") {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        let event = Event(type: .view, createdAt: Date())
        handler.log(event: event)

        XCTAssertEqual(event.link, "https://test-link.com")
    }

    func testLogEventDoesNotOverwriteExistingLink() {
        let handler = makeHandler()

        let exp = expectation(description: "link set")
        handler.setLinkToNewFutureActions(link: "https://future.com") {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        let event = Event(type: .view, createdAt: Date(), link: "https://original.com")
        handler.log(event: event)

        XCTAssertEqual(event.link, "https://original.com",
                       "Should not overwrite an event's existing link")
    }

    func testSetLinkPatchesStoredEventsNilLinks() {
        let handler = makeHandler()

        for event in mockStorage.events {
            event.link = nil
        }
        let eventsBeforePatch = mockStorage.events.count

        let exp = expectation(description: "link patched")
        handler.setLinkToNewFutureActions(link: "https://patched.com") {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        let patchedEvents = mockStorage.events.filter { $0.link == "https://patched.com" }
        XCTAssertEqual(patchedEvents.count, eventsBeforePatch,
                       "All events with nil links created at or after startup should be patched")
    }

    func testSetLinkDoesNotPatchEventsWithExistingLink() {
        let handler = makeHandler()

        for event in mockStorage.events {
            event.link = "https://existing.com"
        }

        let exp = expectation(description: "link set")
        handler.setLinkToNewFutureActions(link: "https://new.com") {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        let keptOriginal = mockStorage.events.filter { $0.link == "https://existing.com" }
        XCTAssertEqual(keptOriginal.count, mockStorage.events.count,
                       "Events with existing links should not be overwritten")
    }

    func testSetLinkToNilSetsHasFetchedPayloadLinkAndTriggersEventSending() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true

        let event = Event(type: .view, createdAt: Date(), link: "https://link.com")
        mockStorage.events.append(event)

        let exp = expectation(description: "nil link triggers send")
        handler.setLinkToNewFutureActions(link: nil) {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(mockService.addEventCallCount, 1,
                       "Setting nil link should trigger sending exactly 1 event")
        XCTAssertEqual(mockService.allAddedEvents.first?.id, event.id,
                       "The sent event should be the one in storage")
    }

    func testHandleEventsIfNeededSendsWhenConditionsMet() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true

        let event = Event(type: .view, createdAt: Date(), link: "https://link.com")
        mockStorage.events.append(event)

        let exp = expectation(description: "events sent")
        handler.handleEventsIfNeeded {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(mockService.addEventCallCount, 1)
        XCTAssertFalse(mockStorage.events.contains(where: { $0.id == event.id }),
                       "Event should be removed from storage after successful send")
    }

    func testHandleEventsIfNeededKeepsEventsOnFailure() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true

        let event = Event(type: .view, createdAt: Date(), link: "https://link.com")
        mockStorage.events.append(event)
        mockService.addEventResult = false

        let exp = expectation(description: "events send failed")
        handler.handleEventsIfNeeded {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(mockStorage.events.contains(where: { $0.id == event.id }),
                      "Event should remain in storage after failed send")
        XCTAssertEqual(mockService.addEventCallCount, 1,
                       "API should still have been called once")
    }

    func testHandleEventsIfNeededSendsEachNonTimeSpentEvent() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true

        let event1 = Event(type: .view, createdAt: Date(), link: "https://l.com")
        let event2 = Event(type: .open, createdAt: Date(), link: "https://l.com")
        mockStorage.events.append(contentsOf: [event1, event2])

        let exp = expectation(description: "events sent")
        handler.handleEventsIfNeeded {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(mockService.addEventCallCount, 2,
                       "API should be called once per non-timeSpent event")
        let sentIDs = Set(mockService.allAddedEvents.map { $0.id })
        XCTAssertTrue(sentIDs.contains(event1.id), "event1 should have been sent")
        XCTAssertTrue(sentIDs.contains(event2.id), "event2 should have been sent")
        XCTAssertTrue(mockStorage.events.isEmpty, "All events should be removed after success")
    }

    func testHandleEventsIfNeededSkipsTimeSpentEvents() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true

        let normalEvent = Event(type: .view, createdAt: Date(), link: "https://l.com")
        let timeSpentEvent = Event(type: .timeSpent, createdAt: Date(), link: "https://l.com")
        mockStorage.events.append(contentsOf: [normalEvent, timeSpentEvent])

        let exp = expectation(description: "events sent")
        handler.handleEventsIfNeeded {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(mockService.addEventCallCount, 1,
                       "Only the non-timeSpent event should be sent")
        XCTAssertEqual(mockService.allAddedEvents.first?.id, normalEvent.id)
        XCTAssertTrue(mockStorage.events.contains(where: { $0.id == timeSpentEvent.id }),
                      "timeSpent event should remain in storage")
    }

    func testHandleEventsIfNeededDoesNotSendWithoutPayloadLink() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true

        mockStorage.events.append(Event(type: .view, createdAt: Date(), link: "https://l.com"))

        let exp = expectation(description: "completion")
        handler.handleEventsIfNeeded {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(mockService.addEventCallCount, 0,
                       "Should not send when hasFetchedPayloadLink is false")
    }

    func testHandleEventsIfNeededDoesNotSendWithoutDelegatesOrLeeway() {
        let handler = makeCleanHandler()
        handler.hasFetchedPayloadLink = true

        mockStorage.events.append(Event(type: .view, createdAt: Date(), link: "https://l.com"))

        let exp = expectation(description: "completion")
        handler.handleEventsIfNeeded {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(mockService.addEventCallCount, 0,
                       "Should not send when handledAppOrSceneDelegates is false and leeway not passed")
    }

    func testSettingHandledAppOrSceneDelegatesTriggersSendWhenReady() {
        let handler = makeCleanHandler()
        handler.hasFetchedPayloadLink = true

        let event = Event(type: .view, createdAt: Date(), link: "https://l.com")
        mockStorage.events.append(event)

        XCTAssertEqual(mockService.addEventCallCount, 0)

        handler.handledAppOrSceneDelegates = true

        XCTAssertEqual(mockService.addEventCallCount, 1,
                       "Setting handledAppOrSceneDelegates should trigger pending event send")
    }

    func testApplicationDidBecomeActiveAddsTimeSpentEvent() {
        let handler = makeHandler()
        let countBefore = mockStorage.events.count

        handler.applicationDidBecomeActive()

        let timeSpentEvents = mockStorage.events.filter { $0.type == .timeSpent }
        XCTAssertEqual(timeSpentEvents.count, 1,
                       "Should add exactly one timeSpent event when no resign timestamp exists")
        XCTAssertEqual(mockStorage.events.count, countBefore + 1)
    }

    func testApplicationDidBecomeActiveTimeSpentEventHasLinkForFutureActions() {
        let handler = makeHandler()

        let exp = expectation(description: "link set")
        handler.setLinkToNewFutureActions(link: "https://active.com") {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        handler.applicationDidBecomeActive()

        let timeSpentEvents = mockStorage.events.filter { $0.type == .timeSpent }
        XCTAssertEqual(timeSpentEvents.last?.link, "https://active.com",
                       "timeSpent event should carry the current linkForFutureActions")
    }

    func testApplicationWillResignActiveSavesTimestamp() {
        let handler = makeHandler()

        handler.applicationWillResignActive()

        let savedTimestamp = mockDefaults.store[.superboardResignTimestamp] ?? 0
        XCTAssertGreaterThan(savedTimestamp, 0,
                             "Should save a non-zero resign timestamp to mock defaults")
    }

    func testIsLeewayPassedReturnsFalseImmediatelyAfterInit() {
        let handler = makeHandler()
        XCTAssertFalse(handler.isLeewayPassed(),
                       "Leeway (5s) should not have passed immediately after init")
    }

    func testApplicationDidBecomeActiveWithResignTimestampHandlesOldEvents() {
        mockDefaults.store[.superboardResignTimestamp] = Date().toSeconds()

        let handler = makeHandler()
        let countBefore = mockStorage.events.count

        handler.applicationDidBecomeActive()

        let exp = expectation(description: "main queue drained")
        DispatchQueue.main.async { exp.fulfill() }
        wait(for: [exp], timeout: 5)

        let timeSpentEvents = mockStorage.events.filter { $0.type == .timeSpent }
        XCTAssertGreaterThanOrEqual(timeSpentEvents.count, 1,
                                    "Should add timeSpent event even with resign timestamp")
        XCTAssertGreaterThan(mockStorage.events.count, countBefore,
                             "Should have added events")
    }

    func testInitAddsAppOpenEvent() {
        _ = makeHandler()

        let appOpenEvents = mockStorage.events.filter { $0.type == .appOpen }
        XCTAssertEqual(appOpenEvents.count, 1,
                       "Init should add exactly one appOpen event")
    }

    func testInitAddsInstallEventOnFirstOpenWithNoKeychainID() {
        _ = makeHandler()

        let installEvents = mockStorage.events.filter { $0.type == .install }
        XCTAssertEqual(installEvents.count, 1,
                       "First open with no keychain ID should add install event")
        let reinstallEvents = mockStorage.events.filter { $0.type == .reinstall }
        XCTAssertEqual(reinstallEvents.count, 0,
                       "Should not add reinstall when no keychain ID exists")
    }

    func testInitAddsReinstallEventOnFirstOpenWithKeychainID() {
        mockKeychain.store[.linksquaredID] = "some-id"

        _ = makeHandler()

        let reinstallEvents = mockStorage.events.filter { $0.type == .reinstall }
        XCTAssertEqual(reinstallEvents.count, 1,
                       "First open with existing keychain ID should add reinstall event")
        let installEvents = mockStorage.events.filter { $0.type == .install }
        XCTAssertEqual(installEvents.count, 0,
                       "Should not add install when keychain ID exists")
    }

    func testInitIncrementsNumberOfOpens() {
        XCTAssertEqual(mockDefaults.store[.superboardNumberOfOpens] ?? 0, 0)

        _ = makeHandler()

        XCTAssertEqual(mockDefaults.store[.superboardNumberOfOpens], 1,
                       "Init should increment numberOfOpens")
    }

    func testInitDoesNotAddInstallEventOnSubsequentOpens() {
        mockDefaults.store[.superboardNumberOfOpens] = 5

        _ = makeHandler()

        let installEvents = mockStorage.events.filter { $0.type == .install || $0.type == .reinstall }
        XCTAssertEqual(installEvents.count, 0,
                       "Should not add install event when numberOfOpens > 0")
    }

    func testInitSavesLastStartTimestamp() {
        _ = makeHandler()

        let timestamp = mockDefaults.store[.superboardLastStartTimestamp] ?? 0
        XCTAssertGreaterThan(timestamp, 0,
                             "Init should save lastStartTimestamp")
    }

    func testInitAddsReactivationEventAtExactly7Days() {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let exactly7DaysAgo = calendar.date(byAdding: .day, value: -7, to: startOfToday)!
        mockDefaults.store[.superboardLastStartTimestamp] = exactly7DaysAgo.toSeconds()
        mockDefaults.store[.superboardNumberOfOpens] = 5

        _ = makeHandler()

        let reactivations = mockStorage.events.filter { $0.type == .reactivation }
        XCTAssertEqual(reactivations.count, 1,
                       "Should add reactivation event at exactly 7 days")
    }

    func testInitDoesNotAddReactivationEventAt6CalendarDays() {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let sixDaysAgo = calendar.date(byAdding: .day, value: -6, to: startOfToday)!
        mockDefaults.store[.superboardLastStartTimestamp] = sixDaysAgo.toSeconds()
        mockDefaults.store[.superboardNumberOfOpens] = 5

        _ = makeHandler()

        let reactivations = mockStorage.events.filter { $0.type == .reactivation }
        XCTAssertEqual(reactivations.count, 0,
                       "Should not add reactivation event at 6 calendar days (threshold is 7)")
    }

    func testInitAddsReactivationEventWhenLastStartWas8DaysAgo() {
        let eightDaysAgo = Date(timeIntervalSinceNow: -8 * 86400)
        mockDefaults.store[.superboardLastStartTimestamp] = eightDaysAgo.toSeconds()
        mockDefaults.store[.superboardNumberOfOpens] = 5

        _ = makeHandler()

        let reactivations = mockStorage.events.filter { $0.type == .reactivation }
        XCTAssertEqual(reactivations.count, 1,
                       "Should add reactivation event when last start was 8 days ago")
    }

    func testInitDoesNotAddReactivationEventOnFirstOpen() {
        _ = makeHandler()

        let reactivations = mockStorage.events.filter { $0.type == .reactivation }
        XCTAssertEqual(reactivations.count, 0,
                       "Should not add reactivation event on first open")
    }

    func testHandleOldEngagementEventsCalculatesEngagementTime() {
        let handler = makeCleanHandler()
        mockService.addEventResult = false

        let createdAt = Date(timeIntervalSinceNow: -30)
        let event = Event(type: .timeSpent, createdAt: createdAt)
        mockStorage.events.append(event)

        let resignDate = Date(timeIntervalSinceNow: -10)
        mockDefaults.store[.superboardResignTimestamp] = resignDate.toSeconds()

        handler.applicationDidBecomeActive()

        let exp = expectation(description: "main queue drained")
        DispatchQueue.main.async { exp.fulfill() }
        wait(for: [exp], timeout: 5)

        let sentEvent = mockService.allAddedEvents.first(where: { $0.id == event.id })
        XCTAssertNotNil(sentEvent?.engagementTime,
                        "engagementTime should be set on timeSpent events")
        if let engagement = sentEvent?.engagementTime {
            XCTAssertGreaterThan(engagement, 0,
                                 "engagementTime should be positive")
        }
    }

    func testHandleOldEngagementEventsDoesNotOverwriteExistingEngagementTime() {
        let handler = makeCleanHandler()
        mockService.addEventResult = false

        let event = Event(type: .timeSpent, createdAt: Date(timeIntervalSinceNow: -60), engagementTime: 42)
        mockStorage.events.append(event)

        let resignDate = Date(timeIntervalSinceNow: -5)
        mockDefaults.store[.superboardResignTimestamp] = resignDate.toSeconds()

        handler.applicationDidBecomeActive()

        let exp = expectation(description: "main queue drained")
        DispatchQueue.main.async { exp.fulfill() }
        wait(for: [exp], timeout: 5)

        let sentEvent = mockService.allAddedEvents.first(where: { $0.id == event.id })
        XCTAssertEqual(sentEvent?.engagementTime, 42,
                       "Existing engagementTime should not be overwritten")
    }

    func testHandleOldEngagementEventsIgnoresNonTimeSpentEvents() {
        let handler = makeCleanHandler()

        let event = Event(type: .view, createdAt: Date(timeIntervalSinceNow: -30))
        mockStorage.events.append(event)

        let resignDate = Date(timeIntervalSinceNow: -5)
        mockDefaults.store[.superboardResignTimestamp] = resignDate.toSeconds()

        handler.applicationDidBecomeActive()

        let exp = expectation(description: "main queue drained")
        DispatchQueue.main.async { exp.fulfill() }
        wait(for: [exp], timeout: 5)

        let original = mockStorage.events.first(where: { $0.id == event.id })
        XCTAssertNil(original?.engagementTime,
                     "Non-timeSpent events should not get engagementTime")
    }

    func testHandleOldEngagementEventsSkipsNegativeDuration() {
        let handler = makeCleanHandler()

        let event = Event(type: .timeSpent, createdAt: Date(timeIntervalSinceNow: 10))
        mockStorage.events.append(event)

        let resignDate = Date(timeIntervalSinceNow: -30)
        mockDefaults.store[.superboardResignTimestamp] = resignDate.toSeconds()

        handler.applicationDidBecomeActive()

        let exp = expectation(description: "main queue drained")
        DispatchQueue.main.async { exp.fulfill() }
        wait(for: [exp], timeout: 5)

        let original = mockStorage.events.first(where: { $0.id == event.id })
        XCTAssertNil(original?.engagementTime,
                     "Negative duration should not set engagementTime")
    }

    func testHandleOldEngagementEventsAddsNewTimeSpentEvent() {
        let handler = makeCleanHandler()

        let resignDate = Date(timeIntervalSinceNow: -5)
        mockDefaults.store[.superboardResignTimestamp] = resignDate.toSeconds()

        let countBefore = mockStorage.events.count

        handler.applicationDidBecomeActive()

        let exp = expectation(description: "main queue drained")
        DispatchQueue.main.async { exp.fulfill() }
        wait(for: [exp], timeout: 5)

        let newTimeSpent = mockStorage.events.filter { $0.type == .timeSpent }
        XCTAssertGreaterThan(newTimeSpent.count, 0,
                             "Should add a new timeSpent event after processing old ones")
        XCTAssertGreaterThan(mockStorage.events.count, countBefore,
                             "Total event count should increase")
    }

    func testInitDedupsPreventsMultipleInstallEvents() {
        _ = makeHandler()

        let extraInstall = Event(type: .install, createdAt: Date())
        mockStorage.addEvent(event: extraInstall) {}

        let installs = mockStorage.events.filter { $0.type == .install }
        XCTAssertEqual(installs.count, 1,
                       "Dedup should keep only one install event after adding a second")
    }

    func testHandleEventsIfNeededWorksWithAsyncMockDispatch() {
        mockService.completionQueue = .global()
        mockStorage.completionQueue = .global()

        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true

        let event = Event(type: .view, createdAt: Date(), link: "https://l.com")
        mockStorage.events.append(event)

        let exp = expectation(description: "async send")
        handler.handleEventsIfNeeded {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(mockService.addEventCallCount, 1,
                       "Should still send events when mocks dispatch asynchronously")
    }

    func testBackToBackHandleEventsDrainsStorageOnFirstCall() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true

        let event1 = Event(type: .view, createdAt: Date(), link: "https://l.com")
        let event2 = Event(type: .open, createdAt: Date(), link: "https://l.com")
        mockStorage.events.append(contentsOf: [event1, event2])

        let exp1 = expectation(description: "first call")
        let exp2 = expectation(description: "second call")

        handler.handleEventsIfNeeded { exp1.fulfill() }
        handler.handleEventsIfNeeded { exp2.fulfill() }

        wait(for: [exp1, exp2], timeout: 5)

        XCTAssertEqual(mockService.addEventCallCount, 2,
                       "First call should send both events; second call finds storage empty")
        XCTAssertTrue(mockStorage.events.isEmpty,
                      "All events should be drained after both calls")
    }

    func testFailedEventsRetriedOnNextHandleCall() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true

        let event = Event(type: .view, createdAt: Date(), link: "https://l.com")
        mockStorage.events.append(event)
        mockService.addEventResult = false

        let exp1 = expectation(description: "first attempt")
        handler.handleEventsIfNeeded { exp1.fulfill() }
        wait(for: [exp1], timeout: 5)

        XCTAssertTrue(mockStorage.events.contains(where: { $0.id == event.id }),
                      "Event should remain after failed send")

        mockService.addEventResult = true
        let exp2 = expectation(description: "retry")
        handler.handleEventsIfNeeded { exp2.fulfill() }
        wait(for: [exp2], timeout: 5)

        XCTAssertFalse(mockStorage.events.contains(where: { $0.id == event.id }),
                       "Event should be removed after successful retry")
    }

    func testMixedBatchSuccessAndFailure() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true

        let event1 = Event(type: .view, createdAt: Date(), link: "https://l.com")
        let event2 = Event(type: .open, createdAt: Date(), link: "https://l.com")
        let event3 = Event(type: .view, createdAt: Date(), link: "https://l.com")
        mockStorage.events.append(contentsOf: [event1, event2, event3])

        mockService.addEventHandler = { event in
            return event.id != event2.id
        }

        let exp = expectation(description: "mixed batch")
        handler.handleEventsIfNeeded { exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertFalse(mockStorage.events.contains(where: { $0.id == event1.id }),
                       "Event 1 should be removed (succeeded)")
        XCTAssertTrue(mockStorage.events.contains(where: { $0.id == event2.id }),
                      "Event 2 should remain (failed)")
        XCTAssertFalse(mockStorage.events.contains(where: { $0.id == event3.id }),
                       "Event 3 should be removed (succeeded)")
    }

    func testMultiThreadedHandleEventsDoesNotDuplicateSends() {
        mockService.completionQueue = .global()
        mockStorage.completionQueue = .global()

        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true

        let event = Event(type: .view, createdAt: Date(), link: "https://l.com")
        mockStorage.events.append(event)

        let iterations = 10
        let allDone = expectation(description: "all iterations done")
        allDone.expectedFulfillmentCount = iterations

        for _ in 0..<iterations {
            DispatchQueue.global().async {
                handler.handleEventsIfNeeded {
                    allDone.fulfill()
                }
            }
        }

        wait(for: [allDone], timeout: 10)

        XCTAssertEqual(mockService.addEventCallCount, 1,
                       "Only one thread should win the sendingEvents guard and send the event")
    }

    func testEventsAreBatchedAndAllSentOnFlush() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true

        let events = (0..<5).map { _ in
            Event(type: .view, createdAt: Date(), link: "https://l.com")
        }
        mockStorage.events.append(contentsOf: events)

        let exp = expectation(description: "all sent")
        handler.handleEventsIfNeeded {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(mockService.addEventCallCount, 5,
                       "All 5 events should be sent in one flush")
        let sentIDs = Set(mockService.allAddedEvents.map { $0.id })
        for event in events {
            XCTAssertTrue(sentIDs.contains(event.id), "Event \(event.id) should have been sent")
        }
        XCTAssertTrue(mockStorage.events.isEmpty,
                      "All events should be removed after successful send")
    }

    func testEventCreatedBeforeAuthIsSentAfterLinkSet() {
        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true

        let event = Event(type: .view, createdAt: Date())
        mockStorage.events.append(event)

        XCTAssertEqual(mockService.addEventCallCount, 0)

        let exp = expectation(description: "link set triggers send")
        handler.setLinkToNewFutureActions(link: "https://auth.com") {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(event.link, "https://auth.com",
                       "Event created before auth should get the link assigned")
    }

    func testHandleEventsIfNeededKeepsEventsOnFailureWithAsyncDispatch() {
        mockService.completionQueue = .global()
        mockStorage.completionQueue = .global()

        let handler = makeCleanHandler()
        handler.handledAppOrSceneDelegates = true
        handler.hasFetchedPayloadLink = true
        mockService.addEventResult = false

        let event = Event(type: .view, createdAt: Date(), link: "https://l.com")
        mockStorage.events.append(event)

        let exp = expectation(description: "async failure")
        handler.handleEventsIfNeeded {
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(mockStorage.events.contains(where: { $0.id == event.id }),
                      "Event should remain in storage after failed async send")
        XCTAssertEqual(mockService.addEventCallCount, 1)
    }
}

import Foundation
@testable import SuperBoard

class MockEventsStorage: EventsStorageProtocol {
    var events: [Event] = []

    var completionQueue: DispatchQueue?

    var addEventCallCount = 0
    var addOrReplaceCallCount = 0
    var removeEventCallCount = 0
    var getEventsCallCount = 0
    var transformEventsCallCount = 0

    private let realStorage = EventsStorage()

    func addEvent(event: Event, completion: @escaping SuperBoardEmptyClosure) {
        addEventCallCount += 1
        events.append(event)
        events = removeDuplicateEventsIfNeeded(events: events)
        dispatch { completion() }
    }

    func addOrReplaceEvents(events: [Event], completion: @escaping SuperBoardEmptyClosure) {
        addOrReplaceCallCount += 1
        var existing = removeDuplicateEventsIfNeeded(events: self.events)
        for event in events {
            if let index = existing.firstIndex(where: { $0.id == event.id }) {
                existing[index] = event
            } else {
                existing.append(event)
            }
        }
        self.events = existing
        dispatch { completion() }
    }

    func removeEvent(event: Event, completion: @escaping SuperBoardEmptyClosure) {
        removeEventCallCount += 1
        events.removeAll(where: { $0.id == event.id })
        dispatch { completion() }
    }

    func getEvents(completion: @escaping SuperBoardEventsClosure) {
        getEventsCallCount += 1
        let snapshot = events
        dispatch { completion(snapshot) }
    }

    func transformEvents(_ transform: @escaping (Event) -> Event, completion: @escaping SuperBoardEmptyClosure) {
        transformEventsCallCount += 1
        events = events.map(transform)
        dispatch { completion() }
    }

    func removeDuplicateEventsIfNeeded(events: [Event]) -> [Event] {
        return realStorage.removeDuplicateEventsIfNeeded(events: events)
    }

    func reset() {
        events.removeAll()
        addEventCallCount = 0
        addOrReplaceCallCount = 0
        removeEventCallCount = 0
        getEventsCallCount = 0
        transformEventsCallCount = 0
    }

    private func dispatch(_ block: @escaping () -> Void) {
        if let queue = completionQueue {
            queue.async { block() }
        } else {
            block()
        }
    }
}

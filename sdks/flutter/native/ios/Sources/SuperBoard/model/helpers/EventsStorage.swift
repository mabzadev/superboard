import Foundation

typealias SuperBoardEventsClosure = (_ events: [Event]?) -> Void

protocol EventsStorageProtocol {
    func addEvent(event: Event, completion: @escaping SuperBoardEmptyClosure)
    func addOrReplaceEvents(events: [Event], completion: @escaping SuperBoardEmptyClosure)
    func removeEvent(event: Event, completion: @escaping SuperBoardEmptyClosure)
    func getEvents(completion: @escaping SuperBoardEventsClosure)
    func transformEvents(_ transform: @escaping (Event) -> Event, completion: @escaping SuperBoardEmptyClosure)
    func removeDuplicateEventsIfNeeded(events: [Event]) -> [Event]
}

class EventsStorage: EventsStorageProtocol {

    private struct Constants {
        static let cachedEvents = "cached-events"
    }

    private let dataCache: DataCache = {
        let appSupport = NSSearchPathForDirectoriesInDomains(.applicationSupportDirectory, .userDomainMask, true).first!
        return DataCache(name: "superboard-events-cache", path: appSupport)
    }()

    private let serialQueue = DispatchQueue(label: "com.superboard-events-queue", qos: .utility)

    func addOrReplaceEvents(events: [Event], completion: @escaping SuperBoardEmptyClosure) {
        serialQueue.async {
            var existingEvents: [Event] = []

            if let readEvents = self.dataCache.readArray(forKey: Constants.cachedEvents) as? [Event] {
                existingEvents = readEvents
            }

            existingEvents = self.removeDuplicateEventsIfNeeded(events: existingEvents)

            for sourceEvent in events {
                if let existingIndex = existingEvents.firstIndex(where: { $0.id == sourceEvent.id }) {
                    existingEvents[existingIndex] = sourceEvent
                } else {
                    existingEvents.append(sourceEvent)
                }
            }

            self.dataCache.writeSync(array: existingEvents, forKey: Constants.cachedEvents)

            completion()
        }
    }

    func addEvent(event: Event, completion: @escaping SuperBoardEmptyClosure) {
        serialQueue.async {
            var events: [Event] = []

            if let readEvents = self.dataCache.readArray(forKey: Constants.cachedEvents) as? [Event] {
                events = readEvents
            }

            events.append(event)
            let existingEvents = self.removeDuplicateEventsIfNeeded(events: events)

            self.dataCache.writeSync(array: existingEvents, forKey: Constants.cachedEvents)

            completion()
        }
    }

    func removeEvent(event: Event, completion: @escaping SuperBoardEmptyClosure) {
        serialQueue.async {
            if var readEvents = self.dataCache.readArray(forKey: Constants.cachedEvents) as? [Event] {
                readEvents.removeAll(where: { $0.id == event.id })

                self.dataCache.writeSync(array: readEvents, forKey: Constants.cachedEvents)
            }

            completion()
        }
    }

    func transformEvents(_ transform: @escaping (Event) -> Event, completion: @escaping SuperBoardEmptyClosure) {
        serialQueue.async {
            guard let events = self.dataCache.readArray(forKey: Constants.cachedEvents) as? [Event] else {
                completion()
                return
            }

            let transformed = events.map(transform)
            self.dataCache.writeSync(array: transformed, forKey: Constants.cachedEvents)

            completion()
        }
    }

    func getEvents(completion: @escaping SuperBoardEventsClosure) {
        serialQueue.async {
            let readEvents = self.dataCache.readArray(forKey: Constants.cachedEvents) as? [Event]

            completion(readEvents)
        }
    }

    func removeDuplicateEventsIfNeeded(events: [Event]) -> [Event] {
        var newEvents = events

        var hasInstall = false
        if let latestInstallEvent = events.filter({ $0.type == .install }).max(by: { $0.createdAt < $1.createdAt }) {
            newEvents.removeAll { $0.type == .install }
            newEvents.append(latestInstallEvent)
            hasInstall = true
        }

        if hasInstall {
            newEvents.removeAll { $0.type == .reinstall }

        } else if let latestReinstallEvent = events.filter({ $0.type == .reinstall }).max(by: { $0.createdAt < $1.createdAt }) {
            newEvents.removeAll { $0.type == .reinstall }
            newEvents.append(latestReinstallEvent)
        }

        return newEvents
    }
}

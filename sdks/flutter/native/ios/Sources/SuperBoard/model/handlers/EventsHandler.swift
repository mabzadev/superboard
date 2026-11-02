import UIKit

typealias SuperBoardChangeEventClosure = (_ oldEvent: Event) -> Event
public typealias SuperBoardEmptyClosure = () -> Void

class EventsHandler {

    private struct Constants {
        static let firstBatchEventsSendingLeeway: Double = 5.0
        static let numberOfDaysForReactivation: Int = 7
        static let maxEventAgeDays: Int = 7
    }

    private let service: APIServiceProtocol
    private let storage: EventsStorageProtocol
    private let userDefaults: UserDefaultsHelperProtocol
    private let keychain: KeychainHelperProtocol
    private let sendingQueue = DispatchQueue(label: "com.superboard.eventsHandler.sending")
    private var linkForFutureActions: String?
    private var sendingEvents = false
    private var sendingTimeSpentEvents = false
    var hasFetchedPayloadLink = false
    private var startupTime: Date!

    var handledAppOrSceneDelegates = false {
        didSet {
            handleEventsIfNeeded(completion: nil)
        }
    }

    init(apiService: APIServiceProtocol,
         storage: EventsStorageProtocol = EventsStorage(),
         userDefaults: UserDefaultsHelperProtocol = UserDefaultsHelper(),
         keychain: KeychainHelperProtocol = KeychainHelper()) {
        self.service = apiService
        self.storage = storage
        self.userDefaults = userDefaults
        self.keychain = keychain

        startupTime = Date()
        Timer.scheduledTimer(withTimeInterval: Constants.firstBatchEventsSendingLeeway, repeats: false) { [weak self] _  in
            self?.handleEventsIfNeeded(completion: nil)
        }

        addObservers()
        addInitialEvents()
        addOpenEvent()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func log(event: Event) {
        let newEvent = event
        if newEvent.link == nil {
            newEvent.link = linkForFutureActions
        }

        storage.addEvent(event: newEvent) { [weak self] in
            self?.handleEventsIfNeeded(completion: nil)
        }
    }

    func setLinkToNewFutureActions(link: String?, completion: SuperBoardEmptyClosure?) {
        if let link {
            self.linkForFutureActions = link
            self.addLinkToEvents(link: link, completion: completion)
        } else {
            self.hasFetchedPayloadLink = true
            self.handleEventsIfNeeded(completion: completion)
        }
    }

    @objc func applicationDidBecomeActive() {
        let lastResignTimestamp = userDefaults.getInt(key: .superboardResignTimestamp)
        if lastResignTimestamp != 0 {
            handleOldEngagementEvents(timestamp: Date.fromSeconds(lastResignTimestamp))
        } else {
            let event = Event(type: .timeSpent, createdAt: Date(), link: linkForFutureActions)
            storage.addEvent(event: event) {
            }
        }
    }

    @objc func applicationWillResignActive() {
        userDefaults.setInt(value: Date().toSeconds(), key: .superboardResignTimestamp)
    }

    private func addInitialEvents() {
        addInstallIfNeeded()
        addReactivationIfNeeded()

        userDefaults.setInt(value: userDefaults.getInt(key: .superboardNumberOfOpens) + 1, key: .superboardNumberOfOpens)
    }

    private func addInstallIfNeeded() {
        let numberOfOpens = userDefaults.getInt(key: .superboardNumberOfOpens)
        let linksquaredID = keychain.getValue(forKey: .linksquaredID)

        if numberOfOpens == 0 {
            let event = linksquaredID != nil ? Event(type: .reinstall, createdAt: Date(), link: linkForFutureActions) : Event(type: .install, createdAt: Date(), link: linkForFutureActions)
            storage.addOrReplaceEvents(events: [event]) {
            }
        }
    }

    private func addReactivationIfNeeded() {
        let lastResignTimestamp = userDefaults.getInt(key: .superboardLastStartTimestamp)
        if lastResignTimestamp != 0 {
            let lastResignDate = Date.fromSeconds(lastResignTimestamp)

            if let days = lastResignDate.daysBetween(Date()), days >= Constants.numberOfDaysForReactivation {

                let event = Event(type: .reactivation, createdAt: Date(), link: linkForFutureActions)
                storage.addEvent(event: event) {
                }
            }
        }

        userDefaults.setInt(value: Date().toSeconds(), key: .superboardLastStartTimestamp)
    }

    private func addOpenEvent() {
        let event = Event(type: .appOpen, createdAt: Date(), link: linkForFutureActions)
        storage.addEvent(event: event) {
        }
    }

    private func addObservers() {
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(applicationDidBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification,
                                               object: nil)

        NotificationCenter.default.addObserver(self,
                                               selector: #selector(applicationWillResignActive),
                                               name: UIApplication.willResignActiveNotification,
                                               object: nil)
    }

    private func handleOldEngagementEvents(timestamp: Date) {
        let event = Event(type: .timeSpent, createdAt: Date(), link: linkForFutureActions)

        changeStorageEvents { oldEvent in
            let newEvent = oldEvent
            if oldEvent.engagementTime == nil && oldEvent.type == .timeSpent {
                let secondsPassed = Int(timestamp.timeIntervalSince(oldEvent.createdAt))
                if secondsPassed > 0 {
                    newEvent.engagementTime = secondsPassed
                }
            }
            return newEvent
        } completion: {
            self.sendTimeSpentEventsToBackend()
            self.storage.addEvent(event: event) {
            }
        }
    }

    private func addLinkToEvents(link: String, completion: SuperBoardEmptyClosure?) {
        changeStorageEvents { oldEvent in
            let newEvent = oldEvent
            if newEvent.link == nil && newEvent.createdAt >= self.startupTime {
                newEvent.link = link
            }
            return newEvent
        } completion: {
            self.hasFetchedPayloadLink = true
            self.handleEventsIfNeeded(completion: completion)
        }
    }

    private func changeStorageEvents(eventHandling: @escaping SuperBoardChangeEventClosure, completion: SuperBoardEmptyClosure?) {
        storage.transformEvents(eventHandling) {
            DispatchQueue.main.async {
                completion?()
            }
        }
    }

    private func sendNormalEventsToBackend(completion: SuperBoardEmptyClosure?) {
        let alreadySending = sendingQueue.sync { () -> Bool in
            if sendingEvents { return true }
            sendingEvents = true
            return false
        }

        if alreadySending {
            completion?()
            return
        }

        storage.getEvents { events in
            guard let events = events else {
                self.sendingQueue.sync { self.sendingEvents = false }
                completion?()
                return
            }

            DebugLogger.shared.log(.info, "Sending logs to the backend")

            let group = DispatchGroup()
            for event in events {
                if event.type != .timeSpent {
                    if let days = event.createdAt.daysBetween(Date()), days >= Constants.maxEventAgeDays {
                        DebugLogger.shared.log(.error, "Discarding stale event (\(event.type.rawValue)) aged \(days) days")
                        self.storage.removeEvent(event: event) {}
                        continue
                    }

                    group.enter()

                    self.service.addEvent(event: event) { value in
                        if value {
                            self.storage.removeEvent(event: event) {
                                group.leave()
                            }
                        } else {
                            group.leave()
                        }
                    }
                }
            }

            group.notify(queue: .main) {
                self.sendingQueue.sync { self.sendingEvents = false }
                completion?()
            }
        }
    }

    private func sendTimeSpentEventsToBackend() {
        let alreadySending = sendingQueue.sync { () -> Bool in
            if sendingTimeSpentEvents { return true }
            sendingTimeSpentEvents = true
            return false
        }

        if alreadySending { return }

        storage.getEvents { events in
            guard let events = events else {
                self.sendingQueue.sync { self.sendingTimeSpentEvents = false }
                return
            }

            DebugLogger.shared.log(.info, "Sending time-spent logs to the backend")

            let group = DispatchGroup()
            for event in events {
                if event.type == .timeSpent {
                    if let days = event.createdAt.daysBetween(Date()), days >= Constants.maxEventAgeDays {
                        DebugLogger.shared.log(.error, "Discarding stale time-spent event aged \(days) days")
                        self.storage.removeEvent(event: event) {}
                        continue
                    }

                    group.enter()
                    self.service.addEvent(event: event) { value in
                        if value {
                            self.storage.removeEvent(event: event) {
                                group.leave()
                            }
                        } else {
                            group.leave()
                        }
                    }
                }
            }

            group.notify(queue: .main) {
                self.sendingQueue.sync { self.sendingTimeSpentEvents = false }
            }
        }
    }

    func handleEventsIfNeeded(completion: SuperBoardEmptyClosure?) {
        if (handledAppOrSceneDelegates || isLeewayPassed()) && hasFetchedPayloadLink {
            sendNormalEventsToBackend(completion: completion)
        } else {
            completion?()
        }
    }

    func isLeewayPassed() -> Bool {
        guard let startupTime = self.startupTime else {
            return false
        }

        let leewayInterval = Constants.firstBatchEventsSendingLeeway
        let allowedTime = startupTime.addingTimeInterval(leewayInterval)
        let currentTime = Date()

        return currentTime > allowedTime
    }
}

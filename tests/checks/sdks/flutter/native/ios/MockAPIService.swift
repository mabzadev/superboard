import Foundation
@testable import SuperBoard

class MockAPIService: APIServiceProtocol {

    var completionQueue: DispatchQueue?

    var addEventResult: Bool = true
    var addEventCallCount = 0
    var allAddedEvents: [Event] = []
    var addEventHandler: ((Event) -> Bool)?

    func addEvent(event: Event, completion: @escaping SuperBoardBoolCompletion) {
        addEventCallCount += 1
        allAddedEvents.append(event)
        let result = addEventHandler?(event) ?? addEventResult
        dispatch { completion(result) }
    }

    var addPaymentEventResult: Bool = true
    var addPaymentEventCallCount = 0
    var allTransactionData: [TransactionData] = []
    var addPaymentEventHandler: ((TransactionData) -> Bool)?

    func addPaymentEvent(transactionData: TransactionData, completion: @escaping SuperBoardBoolCompletion) {
        addPaymentEventCallCount += 1
        allTransactionData.append(transactionData)
        let result = addPaymentEventHandler?(transactionData) ?? addPaymentEventResult
        dispatch { completion(result) }
    }

    func reset() {
        addEventResult = true
        addEventCallCount = 0
        allAddedEvents.removeAll()
        addEventHandler = nil
        addPaymentEventResult = true
        addPaymentEventCallCount = 0
        allTransactionData.removeAll()
        addPaymentEventHandler = nil
    }

    private func dispatch(_ block: @escaping () -> Void) {
        if let queue = completionQueue {
            queue.async { block() }
        } else {
            block()
        }
    }
}

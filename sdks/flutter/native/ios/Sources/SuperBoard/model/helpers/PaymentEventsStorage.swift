import Foundation

struct PendingTransaction: Codable {
    let id: UUID
    let transaction: TransactionData
    var retryCount: Int = 0
}

protocol PaymentEventsStorageProtocol {
    func markTransactionAsHandled(transactionID: UInt64)
    func removeEvent(transactionID: UInt64)
    func isTransactionHandled(transactionID: UInt64?) -> Bool

    func savePendingTransaction(_ transaction: TransactionData)
    func fetchPendingTransactions() -> [PendingTransaction]
    func removePendingTransaction(id: UUID)
    func incrementRetryCount(id: UUID)
}

class PaymentEventsStorage: PaymentEventsStorageProtocol {

    private struct Constants {
        static let userDefaultsKey = "com.superboard.handled-transaction-ids"
        static let migrationDoneKey = "com.superboard.payment-storage-migrated"
        static let pendingTransactionsKey = "com.superboard.pending-transactions"
        static let legacyCacheName = "superboard-payment-events-cache"
        static let legacyCacheKey = "handled-transaction-ids"
    }

    private let defaults: UserDefaults
    private let queue = DispatchQueue(label: "com.superboard.paymentEventsStorage")

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        migrateFromDataCacheIfNeeded()
    }

    func markTransactionAsHandled(transactionID: UInt64) {
        queue.sync {
            var existingTransactionIDs = fetchHandledTransactionIDs()

            if !existingTransactionIDs.contains(transactionID) {
                existingTransactionIDs.insert(transactionID)
                saveHandledTransactionIDs(existingTransactionIDs)
            }
        }
    }

    func removeEvent(transactionID: UInt64) {
        queue.sync {
            var existingTransactionIDs = fetchHandledTransactionIDs()
            existingTransactionIDs.remove(transactionID)
            saveHandledTransactionIDs(existingTransactionIDs)
        }
    }

    func isTransactionHandled(transactionID: UInt64?) -> Bool {
        queue.sync {
            guard let transactionID else {
                return false
            }

            return fetchHandledTransactionIDs().contains(transactionID)
        }
    }

    func savePendingTransaction(_ transaction: TransactionData) {
        queue.sync {
            var pending = _fetchPendingTransactions()
            pending.append(PendingTransaction(id: UUID(), transaction: transaction))
            savePendingTransactions(pending)
        }
    }

    func fetchPendingTransactions() -> [PendingTransaction] {
        queue.sync {
            _fetchPendingTransactions()
        }
    }

    func removePendingTransaction(id: UUID) {
        queue.sync {
            var pending = _fetchPendingTransactions()
            pending.removeAll { $0.id == id }
            savePendingTransactions(pending)
        }
    }

    func incrementRetryCount(id: UUID) {
        queue.sync {
            var pending = _fetchPendingTransactions()
            if let index = pending.firstIndex(where: { $0.id == id }) {
                pending[index].retryCount += 1
                savePendingTransactions(pending)
            }
        }
    }

    private func _fetchPendingTransactions() -> [PendingTransaction] {
        guard let data = defaults.data(forKey: Constants.pendingTransactionsKey) else {
            return []
        }
        do {
            return try JSONDecoder().decode([PendingTransaction].self, from: data)
        } catch {
            DebugLogger.shared.log(.error, "Failed to decode pending transactions: \(error.localizedDescription)")
            return []
        }
    }

    private func savePendingTransactions(_ pending: [PendingTransaction]) {
        do {
            let data = try JSONEncoder().encode(pending)
            defaults.set(data, forKey: Constants.pendingTransactionsKey)
        } catch {
            DebugLogger.shared.log(.error, "Failed to encode pending transactions: \(error.localizedDescription)")
        }
    }

    private func fetchHandledTransactionIDs() -> Set<UInt64> {
        guard let array = defaults.object(forKey: Constants.userDefaultsKey) as? [UInt64] else {
            return []
        }
        return Set(array)
    }

    private func saveHandledTransactionIDs(_ transactionIDs: Set<UInt64>) {
        defaults.set(Array(transactionIDs), forKey: Constants.userDefaultsKey)
    }

    private func migrateFromDataCacheIfNeeded() {
        queue.sync {
            guard !defaults.bool(forKey: Constants.migrationDoneKey) else { return }
            defer { defaults.set(true, forKey: Constants.migrationDoneKey) }

            let legacyCache = DataCache(name: Constants.legacyCacheName)
            guard let legacyIDs = legacyCache.readArray(forKey: Constants.legacyCacheKey) as? [UInt64], !legacyIDs.isEmpty else {
                return
            }

            var current = fetchHandledTransactionIDs()
            current.formUnion(legacyIDs)
            saveHandledTransactionIDs(current)

            legacyCache.clean(byKey: Constants.legacyCacheKey)
        }
    }
}

import Foundation

extension Dictionary {

    func dictToData() -> Data? {
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: self, options: .prettyPrinted)

            return jsonData
        } catch {
            DebugLogger.shared.log(.error, "Error converting dictionary to data: \(error.localizedDescription)")
        }

        return nil
    }

    func toString() -> String {
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: self, options: .prettyPrinted)
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                return jsonString
            } else {
                return ""
            }
        } catch {
            DebugLogger.shared.log(.error, "Error converting dictionary to string: \(error)")
            return ""
        }
    }
}

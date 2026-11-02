import Foundation

public enum LogLevel: Int, Comparable {
    case info = 0
    case warn = 1
    case error = 2

    public static func < (lhs: LogLevel, rhs: LogLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    var label: String {
        switch self {
        case .info: return "INFO"
        case .warn: return "WARN"
        case .error: return "ERROR"
        }
    }
}

class DebugLogger {
    public static let shared = DebugLogger()

    public var logLevel: LogLevel = .error

    private init() {}

    public func log(_ level: LogLevel, _ message: String, file: String = #file, function: String = #function, line: Int = #line) {
        guard level >= logLevel else { return }

        let fileName = URL(fileURLWithPath: file).lastPathComponent
        var logMessage = "SUPERBOARD [\(level.label)] \(fileName) -> \(function) [Line \(line)]: \(message)"
        if level == .error {
            logMessage = "\n\n\n" + logMessage + "\n\n\n"
        }

        print(logMessage)
    }
}

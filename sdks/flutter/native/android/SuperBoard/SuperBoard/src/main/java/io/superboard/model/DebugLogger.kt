package io.superboard.model

import android.util.Log

public enum class LogLevel {
    INFO, ERROR
}

class DebugLogger {
    companion object {
        val instance = DebugLogger()
    }

    var logLevel: LogLevel = LogLevel.ERROR

    fun log(level: LogLevel, message: String) {
        if (logLevel == LogLevel.ERROR && level == LogLevel.INFO) {
            return
        }

        val stackTrace = Throwable().stackTrace
        val element = stackTrace[1]
        val fileName = element.fileName
        val functionName = element.methodName
        val lineNumber = element.lineNumber

        var logMessage = "\uD83D\uDD17SUPERBOARD [${level.name}] $fileName -> $functionName [Line $lineNumber]: $message"

        if (level == LogLevel.ERROR) {
            logMessage = "\n\n\n$logMessage\n\n\n"
        }

        when (level) {
            LogLevel.INFO -> Log.d("Logger", logMessage)
            LogLevel.ERROR -> Log.e("Logger", logMessage)
        }
    }

}

package io.superboard.settings

import io.superboard.model.DebugLogger
import io.superboard.model.LogLevel

class SuperBoardSettings {
    var debugLevel: LogLevel = LogLevel.ERROR
        set(value) {
            field = value
            DebugLogger.instance.logLevel = debugLevel
        }
    var useTestEnvironment: Boolean = false
    var sdkEnabled: Boolean = true
    var baseURL: String? = null

}
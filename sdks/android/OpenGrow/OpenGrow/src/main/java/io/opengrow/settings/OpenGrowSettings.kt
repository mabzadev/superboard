package io.opengrow.settings

import io.opengrow.model.DebugLogger
import io.opengrow.model.LogLevel

class OpenGrowSettings {
    var debugLevel: LogLevel = LogLevel.ERROR
        set(value) {
            field = value
            DebugLogger.instance.logLevel = debugLevel
        }
    var useTestEnvironment: Boolean = false
    var sdkEnabled: Boolean = true
    var baseURL: String? = null

}
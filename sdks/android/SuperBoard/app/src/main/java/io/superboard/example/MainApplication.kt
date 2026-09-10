package io.superboard.example

import android.app.Application
import android.os.Build
import io.superboard.SuperBoard
import io.superboard.model.LogLevel

class MainApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        // TODO: Replace with your own API Key
        val API_KEY = BuildConfig.SUPERBOARD_API_KEY
        SuperBoard.configure(application = this, apiKey = API_KEY, useTestEnvironment = true)
        //SuperBoard.useTestEnvironment = true

        //Optionally, you can adjust the debug level for logging:
        SuperBoard.setDebug(LogLevel.INFO)

        SuperBoard.identifier = getDeviceInfo()
        SuperBoard.attributes = mapOf("param1" to "value1", "param2" to 123, "param3" to true)
    }

    fun getDeviceInfo(): String {
        val model = Build.MODEL        // Phone model, e.g., "Pixel 5"
        val manufacturer = Build.MANUFACTURER  // Manufacturer, e.g., "Google"
        return "@$manufacturer $model"
    }
}

package io.opengrow.example

import android.app.Application
import android.os.Build
import io.opengrow.OpenGrow
import io.opengrow.model.LogLevel

class MainApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        // TODO: Replace with your own API Key
        val API_KEY = BuildConfig.OPENGROW_API_KEY
        OpenGrow.configure(application = this, apiKey = API_KEY, useTestEnvironment = true)
        //OpenGrow.useTestEnvironment = true

        //Optionally, you can adjust the debug level for logging:
        OpenGrow.setDebug(LogLevel.INFO)

        OpenGrow.identifier = getDeviceInfo()
        OpenGrow.attributes = mapOf("param1" to "value1", "param2" to 123, "param3" to true)
    }

    fun getDeviceInfo(): String {
        val model = Build.MODEL        // Phone model, e.g., "Pixel 5"
        val manufacturer = Build.MANUFACTURER  // Manufacturer, e.g., "Google"
        return "@$manufacturer $model"
    }
}

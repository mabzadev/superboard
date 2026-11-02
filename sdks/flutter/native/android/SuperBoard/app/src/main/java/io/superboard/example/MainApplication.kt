package io.superboard.example

import android.app.Application
import android.os.Build
import io.superboard.SuperBoard
import io.superboard.model.LogLevel

class MainApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        val API_KEY = BuildConfig.SUPERBOARD_API_KEY
        SuperBoard.configure(application = this, apiKey = API_KEY, useTestEnvironment = true)

        SuperBoard.setDebug(LogLevel.INFO)

        SuperBoard.identifier = getDeviceInfo()
        SuperBoard.attributes = mapOf("param1" to "value1", "param2" to 123, "param3" to true)
    }

    fun getDeviceInfo(): String {
        val model = Build.MODEL
        val manufacturer = Build.MANUFACTURER
        return "@$manufacturer $model"
    }
}

package io.superboard.handlers

import android.content.Context
import io.superboard.settings.SuperBoardSettings
import io.superboard.utils.AppDetailsHelper
import io.superboard.utils.InstantCompat
import io.superboard.utils.WebViewUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import java.time.Instant

class SuperBoardContext {
    @OptIn(ExperimentalCoroutinesApi::class)
    val serialDispatcher = Dispatchers.IO.limitedParallelism(1)
    val settings = SuperBoardSettings()
    var superboardId: String? = null
    var identifier: String? = null
    var pushToken: String? = null
    var attributes: Map<String, Any>? = null
    var lastSeen: InstantCompat? = null

    fun getAppDetails(context: Context): AppDetailsHelper = AppDetailsHelper(context)
    fun getUserAgent(context: Context): String = WebViewUtils.getUserAgent(context)
}
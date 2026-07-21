package io.opengrow.handlers

import android.content.Context
import io.opengrow.settings.OpenGrowSettings
import io.opengrow.utils.AppDetailsHelper
import io.opengrow.utils.InstantCompat
import io.opengrow.utils.WebViewUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import java.time.Instant

class OpenGrowContext {
    @OptIn(ExperimentalCoroutinesApi::class)
    val serialDispatcher = Dispatchers.IO.limitedParallelism(1)
    val settings = OpenGrowSettings()
    var opengrowId: String? = null
    var identifier: String? = null
    var pushToken: String? = null
    var attributes: Map<String, Any>? = null
    var lastSeen: InstantCompat? = null

    fun getAppDetails(context: Context): AppDetailsHelper = AppDetailsHelper(context)
    fun getUserAgent(context: Context): String = WebViewUtils.getUserAgent(context)
}
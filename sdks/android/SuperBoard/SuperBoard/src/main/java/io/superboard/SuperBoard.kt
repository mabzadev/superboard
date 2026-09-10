package io.superboard

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.os.Parcelable
import android.os.SystemClock
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import io.superboard.handlers.ActivityProvider
import io.superboard.handlers.SuperBoardContext
import io.superboard.handlers.SuperBoardManager
import io.superboard.handlers.NotificationsManager
import io.superboard.model.DebugLogger
import io.superboard.model.DeeplinkDetails
import io.superboard.model.LogLevel
import io.superboard.model.events.PaymentEventType
import io.superboard.model.exceptions.SuperBoardErrorCode
import io.superboard.model.exceptions.SuperBoardException
import io.superboard.service.CustomRedirects
import io.superboard.service.TrackingParams
import io.superboard.utils.FlowObservable
import io.superboard.utils.InstantCompat
import io.superboard.utils.LSResult
import io.superboard.utils.ScreenUtils
import io.superboard.utils.flowDelegate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.Serializable
import java.lang.ref.WeakReference

fun interface SuperBoardDeeplinkListener {
    fun onDeeplinkReceived(deeplinkDetails: DeeplinkDetails)
}

fun interface SuperBoardLinkGenerationListener {
    fun onLinkGenerated(link:String?, error: SuperBoardException?)
}

fun interface SuperBoardLinkDetailsListener {
    fun onLinkDetails(linkDetails:Map<String, Any>?, error: SuperBoardException?)
}

fun interface SuperBoardNotificationsListener {
    fun onAutomaticNotificationClosed(isLast:Boolean)
}

public class SuperBoard: ActivityProvider {

    companion object {
        private val instance = SuperBoard()

        /// Indicates if the test environment should be used
        private var useTestEnvironment: Boolean
            get() = instance.superboardContext.settings.useTestEnvironment
            set(value) {
                instance.superboardContext.settings.useTestEnvironment = value
                instance.apiKey?.let {
                    checkConfiguration()
                }
            }

        /// Flow to listen for link and data from which the app was opened from.
        /// The value of this param is null if the app was not opened from a link.
        /// The data provided is same as the one from setOnDeeplinkReceivedListener. This is just for convenience when using kotlin coroutines api.
        @FlowObservable
        @get:FlowObservable
        val openedLinkDetails: DeeplinkDetails?
            get() = instance.openedLinkDetails

        /// The identifier for the current user, normally a userID. This will be visible in the superboard dashboard.
        var identifier: String?
            get() = instance.identifier
            set(value) {
                instance.identifier = value
            }

        /// The push token for the user. This property allows getting and setting the push notification token.
        var pushToken: String?
            get() = instance.pushToken
            set(value) {
                instance.pushToken = value
            }

        /// The attributes for the current user. This will be visible in the superboard dashboard.
        var attributes: Map<String, Any>?
            get() = instance.attributes
            set(value) {
                instance.attributes = value
            }

        /// Configures SuperBoard with the API key from the web console
        fun configure(application: Application, apiKey: String, useTestEnvironment: Boolean, baseURL: String? = null) {
            instance.configure(application, apiKey, useTestEnvironment = useTestEnvironment, baseURL = baseURL)
        }

        /// Disables the SuperBoard SDK.
        /// - Parameter enabled: The log level to set.
        /// Default is true.
        fun setSDK(enabled: Boolean) {
            instance.setSDK(enabled)
        }

        /// Sets the debug level for the SDK log messages.
        fun setDebug(level: LogLevel) {
            instance.setDebug(level)
        }

        /// Generates a link using kotlin coroutine style.
        ///
        /// - Parameters:
        ///   - title: The title of the link.
        ///   - subtitle: The subtitle of the link.
        ///   - imageURL: The URL of the image associated with the link.
        ///   - data: Additional data for the link.
        ///   - tags: Tags for the link.
        ///   - customRedirects: Override the default redirects for a link.
        ///   - showPreviewIos: Show the link preview before redirecting on iOS platform.
        ///   - showPreviewAndroid: Show the link preview before redirecting on Android platform.
        ///   - tracking: Provide utm tracking parameters for your link.
        suspend fun generateLink(title: String? = null,
                                 subtitle: String? = null,
                                 imageURL: String? = null,
                                 data: Map<String, Serializable>? = null,
                                 tags: List<String>? = null,
                                 customRedirects: CustomRedirects? = null,
                                 showPreviewIos: Boolean? = null,
                                 showPreviewAndroid: Boolean? = null,
                                 tracking: TrackingParams? = null): String {
            return instance.generateLink(title = title,
                subtitle = subtitle,
                imageURL = imageURL,
                data = data,
                tags = tags,
                customRedirects = customRedirects,
                showPreviewIos = showPreviewIos,
                showPreviewAndroid = showPreviewAndroid,
                tracking = tracking)
        }

        /// Generates a link.
        ///
        /// - Parameters:
        ///   - title: The title of the link.
        ///   - subtitle: The subtitle of the link.
        ///   - imageURL: The URL of the image associated with the link.
        ///   - data: Additional data for the link.
        ///   - tags: Tags for the link.
        ///   - customRedirects: Override the default redirects for a link.
        ///   - showPreviewIos: Show the link preview before redirecting on iOS platform.
        ///   - showPreviewAndroid: Show the link preview before redirecting on Android platform.
        ///   - tracking: Provide utm tracking parameters for your link.
        ///   - lifecycleOwner: An optional LifecycleOwner to use when calling the listener, by default global one will be used.
        ///   - listener: A closure to be executed after generating the link.
        fun generateLink(title: String? = null,
                         subtitle: String? = null,
                         imageURL: String? = null,
                         data: Map<String, Serializable>? = null,
                         tags: List<String>? = null,
                         customRedirects: CustomRedirects? = null,
                         showPreviewIos: Boolean? = null,
                         showPreviewAndroid: Boolean? = null,
                         tracking: TrackingParams? = null,
                         lifecycleOwner: LifecycleOwner? = null,
                         listener: SuperBoardLinkGenerationListener
        ) {
            instance.generateLink(title, subtitle, imageURL, data, tags, customRedirects, showPreviewIos, showPreviewAndroid, tracking, lifecycleOwner, listener)
        }

        /// Get link details using kotlin coroutine style.
        ///
        /// - Parameters:
        ///   - path: The last part of a superboard link.
        suspend fun linkDetails(path: String): Map<String, Any> {
            return instance.linkDetails(path = path)
        }

        /// Get link details.
        ///
        /// - Parameters:
        ///   - path: The last part of a superboard link.
        ///   - lifecycleOwner: An optional LifecycleOwner to use when calling the listener, by default global one will be used.
        ///   - listener: A closure to be executed with the link details after they are fetched.
        fun linkDetails(path: String,
                         lifecycleOwner: LifecycleOwner? = null,
                         listener: SuperBoardLinkDetailsListener
        ) {
            instance.linkDetails(path = path, lifecycleOwner = lifecycleOwner, listener = listener)
        }

        /// This needs to be called on the launcher activity onStart() to allow the SDK to handle incoming links
        fun onStart(launcherActivity: Activity? = null) {
            instance.onStart(launcherActivity = launcherActivity)
        }

        /// This needs to be called on the launcher activity onNewIntent() to allow the SDK to handle incoming links
        fun onNewIntent(intent: Intent?, launcherActivity: Activity? = null) {
            instance.onNewIntent(intent, launcherActivity = launcherActivity)
        }

        /// Register a listener to receive the link and data from which the app was opened.
        ///
        /// - Parameters:
        ///   - launcherActivity: The launcher activity.
        ///   - listener: A listener to receive the link and data from which the app was opened.
        fun setOnDeeplinkReceivedListener(launcherActivity: Activity?, listener: SuperBoardDeeplinkListener) {
            instance.setOnDeeplinkReceivedListener(launcherActivity, listener)
        }

        /// Log a purchase that happened using the google play billing library (in app purchase).
        ///
        /// - Parameters:
        ///   - originalJson: The original json of the purchase (purchase.originalJson).
        fun logInAppPurchase(originalJson: String) {
            instance.logInAppPurchase(originalJson = originalJson)
        }

        /// Log a custom purchase for your project. If you are making purchases outside of google play, you can use this method to log them in superboard.
        ///
        /// - Parameters:
        ///   - type: The type of the purchase event, a buy or a cancelled event.
        ///   - priceInCents: The purchase price in cents.
        ///   - currency: The currency of the purchase.
        ///   - productId:
        ///   - startDate:
        fun logCustomPurchase(type: PaymentEventType, priceInCents: Int, currency: String, productId: String, startDate: InstantCompat? = InstantCompat.now()) {
            instance.logCustomPurchase(type = type,
                priceInCents = priceInCents,
                currency = currency,
                productId = productId,
                startDate = startDate)
        }

        /// Register a listener for receiving automatic notifications events.
        ///
        /// - Parameters:
        ///   - listener: A listener to receive events about automatic notifications.
        fun setOnAutomaticNotificationsListener(listener: SuperBoardNotificationsListener) {
            instance.setOnAutomaticNotificationsListener(listener = listener)
        }

        /// Show the notifications screen.
        ///
        /// - Parameters:
        ///   - listener: A lambda function to be called when the screen is dismissed.
        fun displayMessagesFragment(onDismissed: (()->Unit)?): Boolean {
            return instance.displayMessagesFragment(onDismissed)
        }

        /// Get the number of unread notifications this device currently has.
        suspend fun numberOfUnreadMessages(): Int? {
            return instance.numberOfUnreadMessages()
        }

        /// Get the number of unread notifications this device currently has.
        fun numberOfUnreadMessages(lifecycleOwner: LifecycleOwner? = null, onResult: ((Int?)->Unit)?) {
            return instance.numberOfUnreadMessages(lifecycleOwner = lifecycleOwner, onResult = onResult)
        }

        /// Checks the configuration validity.
        private fun checkConfiguration() {
            instance.checkConfiguration()
        }

    }

    var openedLinkDetails: DeeplinkDetails? by flowDelegate(null)

    /// The identifier for the current user, normally a userID. This will be visible in the superboard dashboard.
    private var identifier: String?
        get() = superboardManager?.identifier
        set(value) {
            superboardManager?.identifier = value
        }

    /// The push token for the user. This property allows getting and setting the push notification token.
    var pushToken: String?
        get() = superboardManager?.pushToken
        set(value) {
            superboardManager?.pushToken = value
        }

    /// The attributes for the current user. This will be visible in the superboard dashboard.
    private var attributes: Map<String, Any>?
        get() = superboardManager?.attributes
        set(value) {
            superboardManager?.attributes = value
        }

    private var superboardManager: SuperBoardManager? = null
    private var notificationsManager: NotificationsManager? = null

    // This is used for linking the SDK to your account
    private var apiKey: String? = null

    private var application: Application? = null

    private var deeplinkListener: SuperBoardDeeplinkListener? = null
    private var superboardNotificationsListener: SuperBoardNotificationsListener? = null

    private var launcherActivityReference: WeakReference<Activity>? = null
    private var currentActivityReference: WeakReference<Activity>? = null
        set(value) {
            field = value
            if ((field != null) && (superboardManager?.authenticationState == SuperBoardManager.AuthenticationState.AUTHENTICATED)) {
                notificationsManager?.displayAutomaticNotificationsIfNeeded()
            }
            currentActivityReference?.get()?.let {
                ScreenUtils.getScreenResolution(context = it)
            }
        }

    private var handleIntentConflict = false
    private var lastOnStartTime: Long = 0
    private var lastLinkMatched: String? = null
    private var lastMatchedLinkWasDelivered = false
    private val defaultIntent = Intent()

    private var superboardContext = SuperBoardContext()

    private var authenticationJob: Job? = null

    private val applicationLifecycleObserver: Application.ActivityLifecycleCallbacks = object : Application.ActivityLifecycleCallbacks {
        private var numStarted = 0

        override fun onActivityCreated(p0: Activity, p1: Bundle?) {}
        override fun onActivityStarted(activity: Activity) {
            currentActivityReference = WeakReference(activity)

            if (numStarted == 0) {
                // App is in foreground
                onAppForegrounded()
            }
            numStarted++
        }
        override fun onActivityResumed(activity: Activity) {
            currentActivityReference = WeakReference(activity)
        }
        override fun onActivityPaused(activity: Activity) {
            if (currentActivityReference?.get() == activity) currentActivityReference = null
        }
        override fun onActivityStopped(activity: Activity) {
            if (currentActivityReference?.get() == activity) currentActivityReference = null

            numStarted--
            if (numStarted == 0) {
                // App is in background
                onAppBackgrounded()
            }
        }
        override fun onActivitySaveInstanceState(activity: Activity, p1: Bundle) {}
        override fun onActivityDestroyed(activity: Activity) {
            if (currentActivityReference?.get() == activity) currentActivityReference = null
        }

        private fun onAppForegrounded() {
            // App moved to the foreground
            DebugLogger.instance.log(LogLevel.INFO, "App is in the foreground")

            GlobalScope.launch(superboardContext.serialDispatcher) {
                authenticationJob?.join()
                superboardManager?.onAppForegrounded()
            }
        }

        private fun onAppBackgrounded() {
            // App moved to the background
            DebugLogger.instance.log(LogLevel.INFO, "App is in the background")
            superboardManager?.onAppBackgrounded()
        }
    }

    fun configure(application: Application, apiKey: String, useTestEnvironment: Boolean, baseURL: String? = null) {
        val configuredBaseURL = requireNotNull(baseURL?.trim()?.takeIf { it.isNotEmpty() }) {
            "baseURL is required. Configure it from the application environment (for example https://sdk.example.com)."
        }
        this.apiKey = apiKey
        this.application = application
        this.superboardContext.settings.useTestEnvironment = useTestEnvironment
        this.superboardContext.settings.baseURL = configuredBaseURL.trimEnd('/')

        superboardManager = SuperBoardManager(context = application.applicationContext,
            application = application,
            superboardContext = superboardContext,
            apiKey = apiKey)

        notificationsManager = NotificationsManager(context = application.applicationContext,
            superboardContext = superboardContext,
            apiKey = apiKey,
            activityProvider = this)

        checkConfiguration()
        application.registerActivityLifecycleCallbacks(applicationLifecycleObserver)
    }

    fun setSDK(enabled: Boolean) {
        superboardContext.settings.sdkEnabled = enabled
        superboardManager?.setEnabled(enabled)
    }

    fun setDebug(level: LogLevel) {
        superboardContext.settings.debugLevel = level
    }

    suspend fun generateLink(title: String? = null,
                             subtitle: String? = null,
                             imageURL: String? = null,
                             data: Map<String, Serializable>? = null,
                             tags: List<String>? = null,
                             customRedirects: CustomRedirects? = null,
                             showPreviewIos: Boolean? = null,
                             showPreviewAndroid: Boolean? = null,
                             tracking: TrackingParams?): String {
        var link: String? = null
        superboardManager?.let { manager ->
            if (manager.authenticationState == SuperBoardManager.AuthenticationState.RETRYING) {
                val message = "The device is not yet authenticated, check internet connection and try again."
                DebugLogger.instance.log(LogLevel.ERROR, message)
                throw SuperBoardException(message, SuperBoardErrorCode.LINK_GENERATION_ERROR)
            }

            withContext(superboardContext.serialDispatcher) {
                authenticationJob?.join()
                val result = manager.generateLink(
                    title = title,
                    subtitle = subtitle,
                    imageURL = imageURL,
                    data = data,
                    tags = tags,
                    customRedirects = customRedirects,
                    showPreviewIos = showPreviewIos,
                    showPreviewAndroid = showPreviewAndroid,
                    tracking = tracking
                )

                withContext(Dispatchers.Main) {
                    when (result) {
                        is LSResult.Success -> {
                            link = result.data.link
                        }
                        is LSResult.Error -> {
                            throw SuperBoardException(result.exception.message, SuperBoardErrorCode.LINK_GENERATION_ERROR)
                        }
                    }
                }
            }
        } ?: run {
            DebugLogger.instance.log(LogLevel.ERROR,"The SDK is not properly configured. Call SuperBoard.configure(application: Application, apiKey: String) first.")
            throw SuperBoardException("The sdk is not initialized. Initialize the sdk before generating links.", SuperBoardErrorCode.SDK_NOT_INITIALIZED)
        }

        link?.let { link ->
            return link
        } ?: run {
            throw SuperBoardException("Failed to generate the link.", SuperBoardErrorCode.LINK_GENERATION_ERROR)
        }
    }

    fun generateLink(title: String? = null,
                     subtitle: String? = null,
                     imageURL: String? = null,
                     data: Map<String, Serializable>? = null,
                     tags: List<String>? = null,
                     customRedirects: CustomRedirects? = null,
                     showPreviewIos: Boolean? = null,
                     showPreviewAndroid: Boolean? = null,
                     tracking: TrackingParams?,
                     lifecycleOwner: LifecycleOwner? = null,
                     listener: SuperBoardLinkGenerationListener
    ) {
        superboardManager?.let { manager ->
            if (manager.authenticationState == SuperBoardManager.AuthenticationState.RETRYING) {
                val message = "The device is not yet authenticated, check internet connection and try again."
                DebugLogger.instance.log(LogLevel.ERROR, message)
                listener.onLinkGenerated(null, SuperBoardException(message, SuperBoardErrorCode.LINK_GENERATION_ERROR))
                return
            }

            if (lifecycleOwner == null) {
                DebugLogger.instance.log(LogLevel.INFO,"LifecycleScope not provided, will use global scope.")
            }

            val scope = (lifecycleOwner?.lifecycleScope ?: GlobalScope)
            scope.launch(superboardContext.serialDispatcher) {
                authenticationJob?.join()
                val result = manager.generateLink(
                    title = title,
                    subtitle = subtitle,
                    imageURL = imageURL,
                    data = data,
                    tags = tags,
                    customRedirects = customRedirects,
                    showPreviewIos = showPreviewIos,
                    showPreviewAndroid = showPreviewAndroid,
                    tracking = tracking
                )

                withContext(Dispatchers.Main) {
                    when (result) {
                        is LSResult.Success -> {
                            listener.onLinkGenerated(result.data.link, null)
                        }
                        is LSResult.Error -> {
                            listener.onLinkGenerated(null, SuperBoardException(result.exception.message, SuperBoardErrorCode.LINK_GENERATION_ERROR))
                        }
                    }
                }
            }
        } ?: run {
            val message = "The SDK is not properly configured. Call SuperBoard.configure(application: Application, apiKey: String) first."
            DebugLogger.instance.log(LogLevel.ERROR, message)
            listener.onLinkGenerated(null, SuperBoardException(message, SuperBoardErrorCode.LINK_GENERATION_ERROR))
        }
    }

    suspend fun linkDetails(path: String): Map<String, Any> {
        var linkDetails: Map<String, Any>? = null
        superboardManager?.let { manager ->
            if (manager.authenticationState == SuperBoardManager.AuthenticationState.RETRYING) {
                val message = "The device is not yet authenticated, check internet connection and try again."
                DebugLogger.instance.log(LogLevel.ERROR, message)
                throw SuperBoardException(message, SuperBoardErrorCode.LINK_GENERATION_ERROR)
            }

            withContext(superboardContext.serialDispatcher) {
                authenticationJob?.join()
                val result = manager.linkDetails(path = path)

                withContext(Dispatchers.Main) {
                    when (result) {
                        is LSResult.Success -> {
                            linkDetails = result.data.link
                        }
                        is LSResult.Error -> {
                            throw SuperBoardException(result.exception.message, SuperBoardErrorCode.LINK_DETAILS_ERROR)
                        }
                    }
                }
            }
        } ?: run {
            DebugLogger.instance.log(LogLevel.ERROR,"The SDK is not properly configured. Call SuperBoard.configure(application: Application, apiKey: String) first.")
            throw SuperBoardException("The sdk is not initialized. Initialize the sdk before generating links.", SuperBoardErrorCode.SDK_NOT_INITIALIZED)
        }

        linkDetails?.let { linkDetails ->
            return linkDetails
        } ?: run {
            throw SuperBoardException("Failed to get the link details.", SuperBoardErrorCode.LINK_DETAILS_ERROR)
        }
    }

    fun linkDetails(path: String,
                     lifecycleOwner: LifecycleOwner? = null,
                     listener: SuperBoardLinkDetailsListener
    ) {
        superboardManager?.let { manager ->
            if (manager.authenticationState == SuperBoardManager.AuthenticationState.RETRYING) {
                val message = "The device is not yet authenticated, check internet connection and try again."
                DebugLogger.instance.log(LogLevel.ERROR, message)
                listener.onLinkDetails(null, SuperBoardException(message, SuperBoardErrorCode.LINK_DETAILS_ERROR))
                return
            }

            if (lifecycleOwner == null) {
                DebugLogger.instance.log(LogLevel.INFO,"LifecycleScope not provided, will use global scope.")
            }

            val scope = (lifecycleOwner?.lifecycleScope ?: GlobalScope)
            scope.launch(superboardContext.serialDispatcher) {
                authenticationJob?.join()
                val result = manager.linkDetails(path = path)

                withContext(Dispatchers.Main) {
                    when (result) {
                        is LSResult.Success -> {
                            listener.onLinkDetails(result.data.link, null)
                        }
                        is LSResult.Error -> {
                            listener.onLinkDetails(null, SuperBoardException(result.exception.message, SuperBoardErrorCode.LINK_DETAILS_ERROR))
                        }
                    }
                }
            }
        } ?: run {
            val message = "The SDK is not properly configured. Call SuperBoard.configure(application: Application, apiKey: String) first."
            DebugLogger.instance.log(LogLevel.ERROR, message)
            listener.onLinkDetails(null, SuperBoardException(message, SuperBoardErrorCode.LINK_DETAILS_ERROR))
        }
    }

    fun onStart(launcherActivity: Activity? = null) {
        lastOnStartTime = SystemClock.elapsedRealtime()
        handleIntentConflict = false

        launcherActivity?.let {
            launcherActivityReference = WeakReference(launcherActivity)
        }
        handleIntent(launcherActivityReference?.get()?.intent, delayEvents = true, cacheIntent = true)
    }

    fun onNewIntent(intent: Intent?, launcherActivity: Activity? = null) {
        handleIntentConflict = SystemClock.elapsedRealtime() - lastOnStartTime < 2_000L

        launcherActivity?.let {
            launcherActivityReference = WeakReference(launcherActivity)
        }
        handleIntent(intent, delayEvents = false)
    }

    fun setOnDeeplinkReceivedListener(launcherActivity: Activity?, listener: SuperBoardDeeplinkListener) {
        launcherActivity?.let {
            launcherActivityReference = WeakReference(launcherActivity)
        }
        deeplinkListener = listener
    }

    fun logInAppPurchase(originalJson: String) {
        GlobalScope.launch(superboardContext.serialDispatcher) {
            authenticationJob?.join()
            superboardManager?.logInAppPurchase(originalJson = originalJson)
        }
    }

    fun logCustomPurchase(type: PaymentEventType, priceInCents: Int, currency: String, productId: String, startDate: InstantCompat? = InstantCompat.now()) {
        GlobalScope.launch(superboardContext.serialDispatcher) {
            authenticationJob?.join()
            superboardManager?.logCustomPurchase(type = type,
                priceInCents = priceInCents,
                currency = currency,
                productId = productId,
                startDate = startDate)
        }
    }

    fun setOnAutomaticNotificationsListener(listener: SuperBoardNotificationsListener) {
        superboardNotificationsListener = listener
    }

    fun displayMessagesFragment(onDismissed: (()->Unit)?): Boolean {
        notificationsManager?.let { notificationsManager ->
            return notificationsManager.displayNotificationsViewController(onDismissed = onDismissed)
        } ?: run {
            return false
        }
    }

    suspend fun numberOfUnreadMessages(): Int? {
        if (superboardManager?.authenticationState == SuperBoardManager.AuthenticationState.RETRYING) {
            val message = "The device is not yet authenticated, check internet connection and try again."
            DebugLogger.instance.log(LogLevel.ERROR, message)
            return null
        }

        authenticationJob?.join()

        return notificationsManager?.numberOfUnreadNotifications()
    }

    fun numberOfUnreadMessages(lifecycleOwner: LifecycleOwner? = null, onResult: ((Int?)->Unit)?) {
        if (superboardManager?.authenticationState == SuperBoardManager.AuthenticationState.RETRYING) {
            val message = "The device is not yet authenticated, check internet connection and try again."
            DebugLogger.instance.log(LogLevel.ERROR, message)
            onResult?.invoke(null)
            return
        }

        if (lifecycleOwner == null) {
            DebugLogger.instance.log(LogLevel.INFO,"LifecycleScope not provided, will use global scope.")
        }

        val scope = (lifecycleOwner?.lifecycleScope ?: GlobalScope)
        scope.launch(superboardContext.serialDispatcher) {
            authenticationJob?.join()
            val result = notificationsManager?.numberOfUnreadNotifications()

            withContext(Dispatchers.Main) {
                onResult?.invoke(result)
            }
        }

    }

    private fun checkConfiguration() {
        instance.apiKey?.let { apiKey ->
            superboardManager?.let { manager ->
                val previousAuthenticationJob = authenticationJob
                authenticationJob = GlobalScope.launch(superboardContext.serialDispatcher) {
                    previousAuthenticationJob?.join()
                    val response = manager.authenticate()
                    if (response) {
                        manager.start()
                        notificationsManager?.displayAutomaticNotificationsIfNeeded()
                    }
                }
            } ?: run {
                DebugLogger.instance.log(LogLevel.ERROR,"The SDK is not properly configured. Call SuperBoard.configure(application: Application, apiKey: String) first.")
            }
        } ?: run {
            DebugLogger.instance.log(LogLevel.ERROR,"API Key is invalid. Make sure you've used the right value from the Web interface.")
        }
    }

    private fun handleIntent(intent: Intent?, delayEvents: Boolean, cacheIntent: Boolean = false) {
        val intent = intent ?: defaultIntent
        superboardManager?.let { superboardManager ->
            (launcherActivityReference?.get() as? LifecycleOwner)?.let { lifecycleOwner ->
                lifecycleOwner.lifecycleScope.launch(superboardContext.serialDispatcher) {
                    authenticationJob?.join()
                    val result = superboardManager.handleIntent(intent, delayEvents = delayEvents, cacheIntent = cacheIntent)
                    var deliveredToListener = false
                    var ignoredDuplicate = false
                    result?.let { deeplinkDetails ->
                        deeplinkDetails.link?.let {
                            if (
                                handleIntentConflict &&
                                lastMatchedLinkWasDelivered &&
                                lastLinkMatched == deeplinkDetails.link
                            ) {
                                DebugLogger.instance.log(LogLevel.INFO,"Ignoring double intent handling.")
                                handleIntentConflict = false
                                ignoredDuplicate = true
                            } else {
                                withContext(Dispatchers.Main) {
                                    openedLinkDetails = deeplinkDetails
                                    deeplinkListener?.let { listener ->
                                        deliveredToListener = true
                                        listener.onDeeplinkReceived(deeplinkDetails)
                                    }
                                }
                            }
                        } ?: run {
                            DebugLogger.instance.log(LogLevel.INFO,"App NOT opened from deeplink.")
                        }
                    }
                    if (!ignoredDuplicate && result?.link != null) {
                        lastLinkMatched = result.link
                        lastMatchedLinkWasDelivered = deliveredToListener
                    }
                }
            } ?: run {
                DebugLogger.instance.log(LogLevel.ERROR,"The SDK is not properly configured. Call SuperBoard.configure(application: Application, apiKey: String) first.")
            }
        } ?: run {
            DebugLogger.instance.log(LogLevel.ERROR,"The SDK manager is not properly configured. Call SuperBoard.configure(application: Application, apiKey: String) first.")
        }
    }

    override fun requireActivity(): Activity? {
        return currentActivityReference?.get()
    }

    override fun requireNotificationsListener(): SuperBoardNotificationsListener? {
        return superboardNotificationsListener
    }

}

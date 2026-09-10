package io.superboard.wrapper

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.MethodChannel.MethodCallHandler
import io.flutter.plugin.common.MethodChannel.Result
import io.superboard.SuperBoard
import io.superboard.model.CustomLinkRedirect
import io.superboard.model.DebugLogger
import io.superboard.model.LogLevel
import io.superboard.model.exceptions.SuperBoardException
import io.superboard.service.CustomRedirects
import io.superboard.service.TrackingParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import io.superboard.model.events.PaymentEventType
import java.io.Serializable
import java.lang.ref.WeakReference

/** Flutter wrapper for the internal SuperBoard native implementation. */
class SuperBoardPlugin : FlutterPlugin, MethodCallHandler, ActivityAware {
    private lateinit var channel: MethodChannel
    private lateinit var eventChannel: EventChannel
    private var eventSink: EventChannel.EventSink? = null
    private lateinit var context: Context
    private var activityBinding: ActivityPluginBinding? = null
    private val coroutineScope = CoroutineScope(Dispatchers.Main)

    private val applicationLifecycleObserver: Application.ActivityLifecycleCallbacks = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityCreated(p0: Activity, p1: Bundle?) { }
        override fun onActivityStarted(activity: Activity) {
            if (activity is FlutterActivity) {
                SuperBoard.onStart(activity)
            }
        }
        override fun onActivityResumed(activity: Activity) { }
        override fun onActivityPaused(activity: Activity) { }
        override fun onActivityStopped(activity: Activity) { }
        override fun onActivitySaveInstanceState(activity: Activity, p1: Bundle) {}
        override fun onActivityDestroyed(activity: Activity) { }
    }

    override fun onAttachedToEngine(flutterPluginBinding: FlutterPlugin.FlutterPluginBinding) {
        context = flutterPluginBinding.applicationContext
        
        channel = MethodChannel(flutterPluginBinding.binaryMessenger, "superboard")
        channel.setMethodCallHandler(this)
        
        eventChannel = EventChannel(flutterPluginBinding.binaryMessenger, "superboard/deeplinks")
        eventChannel.setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                eventSink = events
                setupDeeplinkListener()
            }

            override fun onCancel(arguments: Any?) {
                eventSink = null
            }
        })

        val application = context as? Application ?: (context.applicationContext as Application)
        application.registerActivityLifecycleCallbacks(applicationLifecycleObserver)

        val app = flutterPluginBinding.applicationContext as Application
        val meta = app.packageManager.getApplicationInfo(app.packageName, PackageManager.GET_META_DATA).metaData
        val apiKey = meta.getString("superboard_api_key")
        val useTestEnvironment = meta.getBoolean("superboard_use_test_environment", false)
        val baseURL = meta.getString("superboard_base_url")
        if (apiKey.isNullOrBlank() || baseURL.isNullOrBlank()) {
            Log.e("SuperBoard", "superboard_api_key and superboard_base_url are required in AndroidManifest.xml")
            return
        }
        SuperBoard.configure(application, apiKey, useTestEnvironment, baseURL)
    }

    private fun setupDeeplinkListener() {
        activityBinding?.activity?.let { activity ->
            SuperBoard.setOnDeeplinkReceivedListener(activity) { linkDetails ->
                coroutineScope.launch {
                    eventSink?.success(mapOf("link" to linkDetails.link, "data" to linkDetails.data, "tracking" to linkDetails.tracking))
                }
            }
        }
    }

    override fun onMethodCall(call: MethodCall, result: Result) {
        when (call.method) {
            "getPlatformVersion" -> {
                result.success("Android ${android.os.Build.VERSION.RELEASE}")
            }

            "getPlatformIdentifier" -> {
                result.success(context.packageName)
            }
            
            "generateLink" -> {
                val title = call.argument<String>("title")
                val subtitle = call.argument<String>("subtitle")
                val imageURL = call.argument<String>("imageURL")
                val data = call.argument<Map<String, Any>>("data")
                val tags = call.argument<List<String>>("tags")
                val customRedirectsMap = call.argument<Map<String, Any>>("customRedirects")
                val showPreviewIos = call.argument<Boolean>("showPreviewIos")
                val showPreviewAndroid = call.argument<Boolean>("showPreviewAndroid")
                val trackingMap = call.argument<Map<String, Any>>("tracking")
                
                if (title == null) {
                    result.error("INVALID_ARGUMENT", "title is required", null)
                    return
                }
                
                // Parse customRedirects
                val customRedirects = customRedirectsMap?.let { redirectsMap ->
                    val ios = (redirectsMap["ios"] as? Map<*, *>)?.let { iosMap ->
                        CustomLinkRedirect(
                            link = iosMap["url"] as? String ?: "",
                            openAppIfInstalled = iosMap["openAppIfInstalled"] as? Boolean ?: true
                        )
                    }
                    val android = (redirectsMap["android"] as? Map<*, *>)?.let { androidMap ->
                        CustomLinkRedirect(
                            link = androidMap["url"] as? String ?: "",
                            openAppIfInstalled = androidMap["openAppIfInstalled"] as? Boolean ?: true
                        )
                    }
                    val desktop = (redirectsMap["desktop"] as? Map<*, *>)?.let { desktopMap ->
                        CustomLinkRedirect(
                            link = desktopMap["url"] as? String ?: "",
                            openAppIfInstalled = desktopMap["openAppIfInstalled"] as? Boolean ?: true
                        )
                    }
                    CustomRedirects(ios = ios, android = android, desktop = desktop)
                }
                
                // Parse tracking params
                val tracking = trackingMap?.let { trackingParams ->
                    TrackingParams(
                        utmCampaign = trackingParams["utm_campaign"] as? String,
                        utmSource = trackingParams["utm_source"] as? String,
                        utmMedium = trackingParams["utm_medium"] as? String
                    )
                }
                
                // Convert data map to Serializable map
                val serializableData = data?.mapValues { entry ->
                    when (val value = entry.value) {
                        is Serializable -> value
                        is Number -> value
                        is String -> value
                        is Boolean -> value
                        else -> value.toString()
                    }
                }
                
                coroutineScope.launch {
                    try {
                        val link = withContext(Dispatchers.IO) {
                            SuperBoard.generateLink(
                                title = title,
                                subtitle = subtitle,
                                imageURL = imageURL,
                                data = serializableData,
                                tags = tags,
                                customRedirects = customRedirects,
                                showPreviewIos = showPreviewIos,
                                showPreviewAndroid = showPreviewAndroid,
                                tracking = tracking
                            )
                        }
                        result.success(link)
                    } catch (e: SuperBoardException) {
                        result.error("GENERATION_ERROR", e.message, null)
                    } catch (e: Exception) {
                        result.error("GENERATION_ERROR", e.message, null)
                    }
                }
            }
            
            "setPushToken" -> {
                val token = call.argument<String>("token")
                
                if (token == null) {
                    result.error("INVALID_ARGUMENT", "token is required", null)
                    return
                }
                
                try {
                    SuperBoard.pushToken = token
                    result.success(null)
                } catch (e: Exception) {
                    result.error("TOKEN_ERROR", e.message, null)
                }
            }

            "numberOfUnreadMessages" -> {
                SuperBoard.numberOfUnreadMessages(onResult = { count ->
                    result.success(count ?: 0)
                })
            }

            "displayMessages" -> {
                try {
                    val displayed = SuperBoard.displayMessagesFragment {
                        result.success(null)
                    }
                    if (!displayed) {
                        result.error("MESSAGES_ERROR", "The SuperBoard message center is unavailable", null)
                    }
                } catch (e: Exception) {
                    result.error("MESSAGES_ERROR", e.message, null)
                }
            }
            
            "setUserIdentifier" -> {
                val identifier = call.argument<String>("identifier")
                
                if (identifier == null) {
                    result.error("INVALID_ARGUMENT", "identifier is required", null)
                    return
                }
                
                try {
                    SuperBoard.identifier = identifier
                    result.success(null)
                } catch (e: Exception) {
                    result.error("USER_ERROR", e.message, null)
                }
            }
            
            "setUserAttributes" -> {
                val attributes = call.argument<Map<String, Any>>("attributes")
                
                if (attributes == null) {
                    result.error("INVALID_ARGUMENT", "attributes are required", null)
                    return
                }
                
                try {
                    SuperBoard.attributes = attributes
                    result.success(null)
                } catch (e: Exception) {
                    result.error("USER_ERROR", e.message, null)
                }
            }
            
            "setDebugLevel" -> {
                val level = call.argument<String>("level")
                
                if (level == null) {
                    result.error("INVALID_ARGUMENT", "level is required", null)
                    return
                }
                
                try {
                    // Convert the public value to the internal native debug level.
                    when (level.lowercase()) {
                        "info" -> SuperBoard.setDebug(LogLevel.INFO)
                        "error" -> SuperBoard.setDebug(LogLevel.ERROR)
                        else -> SuperBoard.setDebug(LogLevel.ERROR)
                    }
                    result.success(null)
                } catch (e: Exception) {
                    result.error("DEBUG_ERROR", e.message, null)
                }
            }
            
            "logInAppPurchase" -> {
                val transactionId = call.argument<String>("transactionId")

                if (transactionId == null) {
                    result.error("INVALID_ARGUMENT", "transactionId is required", null)
                    return
                }

                try {
                    SuperBoard.logInAppPurchase(transactionId)
                    result.success(null)
                } catch (e: Exception) {
                    result.error("PAYMENT_ERROR", e.message, null)
                }
            }

            "logCustomPurchase" -> {
                val typeString = call.argument<String>("type")
                val priceInCents = call.argument<Int>("priceInCents")
                val currency = call.argument<String>("currency")
                val productId = call.argument<String>("productId")
                val startDateString = call.argument<String>("startDate")

                if (typeString == null || priceInCents == null || currency == null || productId == null) {
                    result.error("INVALID_ARGUMENT", "type, priceInCents, currency, and productId are required", null)
                    return
                }

                val type = when (typeString) {
                    "buy" -> PaymentEventType.BUY
                    "cancel" -> PaymentEventType.CANCEL
                    "refund" -> PaymentEventType.REFUND
                    else -> {
                        result.error("INVALID_ARGUMENT", "Invalid transaction type: $typeString", null)
                        return
                    }
                }

                try {
                    SuperBoard.logCustomPurchase(type, priceInCents, currency, productId)
                    result.success(null)
                } catch (e: Exception) {
                    result.error("PAYMENT_ERROR", e.message, null)
                }
            }

            else -> {
                result.notImplemented()
            }
        }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
        eventChannel.setStreamHandler(null)
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activityBinding = binding
        // Set up deeplink listener when activity is available
        if (eventSink != null) {
            setupDeeplinkListener()
        }

        // Add listener for new intents
        binding.addOnNewIntentListener { intent ->
            SuperBoard.onNewIntent(intent, binding.activity)
            false
        }
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activityBinding = null
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activityBinding = binding
        // Re-setup deeplink listener when activity is reattached
        if (eventSink != null) {
            setupDeeplinkListener()
        }
        // Add listener for new intents
        binding.addOnNewIntentListener { intent ->
            SuperBoard.onNewIntent(intent, binding.activity)
            false
        }
    }

    override fun onDetachedFromActivity() {
        activityBinding = null
    }
}

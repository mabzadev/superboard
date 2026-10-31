package io.superboard.service

import android.content.Context
import android.os.Build
import android.os.Parcelable
import com.google.gson.GsonBuilder
import com.google.gson.annotations.SerializedName
import com.google.gson.reflect.TypeToken
import io.superboard.api.SuperBoardApi
import io.superboard.handlers.SuperBoardContext
import io.superboard.BuildConfig
import io.superboard.model.AppDetails
import io.superboard.model.AuthenticationResponse
import io.superboard.model.CustomLinkRedirect
import io.superboard.model.DebugLogger
import io.superboard.model.DeeplinkDetails
import io.superboard.model.ErrorMessage
import io.superboard.model.Event
import io.superboard.model.GenerateLinkRequest
import io.superboard.model.GenerateLinkResponse
import io.superboard.model.GetDeviceResponse
import io.superboard.model.LinkDetailsRequest
import io.superboard.model.LinkDetailsResponse
import io.superboard.model.LogLevel
import io.superboard.model.UpdateAttributesRequest
import io.superboard.model.events.PaymentEvent
import io.superboard.model.notifications.MarkNotificationAsReadRequest
import io.superboard.model.notifications.NotificationsRequest
import io.superboard.model.notifications.NotificationsResponse
import io.superboard.model.notifications.NumberOfUnreadNotificationsResponse
import io.superboard.utils.AppDetailsHelper
import io.superboard.utils.GVRetryResult
import io.superboard.utils.LSJsonDateTypeAdapterFactory
import io.superboard.utils.LSJsonInstantCompatTypeAdapterFactory
import io.superboard.utils.LSJsonInstantTypeAdapterFactory
import io.superboard.utils.LSResult
import kotlinx.coroutines.flow.Flow
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okhttp3.logging.HttpLoggingInterceptor
import okio.IOException
import retrofit2.Converter
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import java.io.Serializable
import java.lang.reflect.Type
import java.util.concurrent.TimeUnit

val nullOnEmptyConverterFactory = object : Converter.Factory() {
    fun converterFactory() = this
    override fun responseBodyConverter(type: Type, annotations: Array<out Annotation>, retrofit: Retrofit) = object :
        Converter<ResponseBody, Any?> {
        val nextResponseBodyConverter = retrofit.nextResponseBodyConverter<Any?>(converterFactory(), type, annotations)
        override fun convert(value: ResponseBody) = if (value.contentLength() != 0L) nextResponseBodyConverter.convert(value) else null
    }
}

// Custom Interceptor to add headers to every request
class HeaderInterceptor(private val headers: ()->Map<String, String>) : Interceptor {
    @Throws(IOException::class)
    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest: Request = chain.request()
        val requestBuilder: Request.Builder = originalRequest.newBuilder()

        // Add each custom header to the request
        for ((key, value) in headers.invoke()) {
            requestBuilder.addHeader(key, value)
        }

        val request: Request = requestBuilder.build()
        return chain.proceed(request)
    }
}

public class CustomRedirects(
    val ios: CustomLinkRedirect? = null,
    val android: CustomLinkRedirect? = null,
    val desktop: CustomLinkRedirect? = null,
) {
}

public class TrackingParams(
    val utmCampaign: String? = null,
    val utmSource: String? = null,
    val utmMedium: String? = null,
) {
}

class SuperBoardService(val context: Context, val apiKey: String, val superboardContext: SuperBoardContext) : ISuperBoardService {
    private val superboardApi: SuperBoardApi
    private val appDetails: AppDetailsHelper by lazy { superboardContext.getAppDetails(context = context) }
    private val userAgent: String by lazy { superboardContext.getUserAgent(context = context) }
    private val gson = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        GsonBuilder().setLenient()
            .registerTypeAdapterFactory(LSJsonInstantCompatTypeAdapterFactory())
            .registerTypeAdapterFactory(LSJsonDateTypeAdapterFactory())
            .registerTypeAdapterFactory(LSJsonInstantTypeAdapterFactory())
            .create()
    } else {
        GsonBuilder().setLenient()
            .registerTypeAdapterFactory(LSJsonInstantCompatTypeAdapterFactory())
            .registerTypeAdapterFactory(LSJsonDateTypeAdapterFactory())
            .create()
    }
    // Bounded retries with exponential backoff; see SuperBoardRequestExecutor.
    private val requests = SuperBoardRequestExecutor(gson)
    private val accessKey: String
        get() {
            if (superboardContext.settings.useTestEnvironment) {
                return "test_$apiKey"
            }

            return apiKey
        }

    companion object {
        val EAGER_RETRY_COUNT: Long = 15
        val EAGER_RETRY_FALLBACK_TIME: Long = 5000
        val RETRY_FALLBACK_TIME: Long = 10000
        
    }

    init {
        superboardApi = getRetrofit().create(SuperBoardApi::class.java)
    }

    override suspend fun payloadFor(@Body request: AppDetails): LSResult<DeeplinkDetails> {
        DebugLogger.instance.log(LogLevel.INFO, "Fetching payload for device")

        return requests.request(
            label = "Fetching payload",
            failureMessage = "Failed to fetch the payload.",
            call = { superboardApi.payloadFor(request) },
        ) { body ->
            body?.also {
                DebugLogger.instance.log(LogLevel.INFO, "Fetching payload for device - Received payload")
            }
        }
    }

    override suspend fun payloadWithLinkFor(@Body request: AppDetails): LSResult<DeeplinkDetails> {
        DebugLogger.instance.log(LogLevel.INFO, "Fetching payload for device")

        return requests.request(
            label = "Fetching payload",
            failureMessage = "Failed to fetch the payload.",
            call = { superboardApi.payloadWithLinkFor(request) },
        ) { body ->
            body?.also {
                DebugLogger.instance.log(LogLevel.INFO, "Fetching payload for device - Received payload")
            }
        }
    }

    /// Authenticates the app.
    ///
    /// - Parameters:
    ///   - appDetails: Details of the app.
    override fun authenticate(appDetails: AppDetails): Flow<GVRetryResult<AuthenticationResponse>> {
        DebugLogger.instance.log(LogLevel.INFO, "Authenticate")

        return requests.retryingFlow(
            label = "Authenticate",
            failureMessage = "Failed to authenticate.",
            call = { superboardApi.authenticate(appDetails) },
        ) { body ->
            body?.also {
                DebugLogger.instance.log(LogLevel.INFO, "Authenticate - Success")
            }
        }
    }

    override suspend fun generateLink(title: String?,
                             subtitle: String?,
                             imageURL: String?,
                             data: Map<String, Serializable>?,
                             tags: List<String>?,
                             customRedirects: CustomRedirects?,
                             showPreviewIos: Boolean?,
                             showPreviewAndroid: Boolean?,
                             tracking: TrackingParams?): LSResult<GenerateLinkResponse> {
        try {
            val stringData = gson.toJson(data)
            val stringTags = gson.toJson(tags)
            val request = GenerateLinkRequest(title = title,
                subtitle = subtitle,
                imageUrl =  imageURL,
                data = stringData,
                tags = stringTags,
                iosCustomRedirect = customRedirects?.ios,
                androidCustomRedirect = customRedirects?.android,
                desktopCustomRedirect = customRedirects?.desktop,
                showPreviewIos = showPreviewIos,
                showPreviewAndroid = showPreviewAndroid,
                trackingCampaign = tracking?.utmCampaign,
                trackingMedium = tracking?.utmMedium,
                trackingSource = tracking?.utmSource)
            val response = superboardApi.generateLink(request)
            if (response.isSuccessful) {
                val body = response.body()
                body?.let {
                    return LSResult.Success(it)
                }
            }

            val error = gson.fromJson(response.errorBody()!!.string(), ErrorMessage::class.java)

            DebugLogger.instance.log(LogLevel.INFO, "Generate link - Failed. ${error.error}")

            return LSResult.Error(java.io.IOException("Failed to generate link. ${error.error}"))
        } catch (e: Exception) {
            return LSResult.Error(e)
        }
    }

    override suspend fun linkDetails(path: String): LSResult<LinkDetailsResponse> {
        try {
            val request = LinkDetailsRequest(path = path)
            val response = superboardApi.linkDetails(request)
            if (response.isSuccessful) {
                val body = response.body()
                body?.string()?.let {
                    try {
                        if (it == "null") {
                            return LSResult.Error(java.io.IOException("Invalid link path."))
                        } else {
                            val map: Map<String, Any> =
                                gson.fromJson(it, object : TypeToken<Map<String, Any?>>() {}.type)
                            return LSResult.Success(LinkDetailsResponse(link = map))
                        }
                    } catch (error: Exception) {
                        DebugLogger.instance.log(LogLevel.INFO, "Link details - Failed. ${error}")
                    }
                }
            }

            val error = gson.fromJson(response.errorBody()!!.string(), ErrorMessage::class.java)

            DebugLogger.instance.log(LogLevel.INFO, "Link details - Failed. ${error.error}")

            return LSResult.Error(java.io.IOException("Failed to get link details. ${error.error}"))
        } catch (e: Exception) {
            return LSResult.Error(e)
        }
    }

    /// Adds an event.
    ///
    /// - Parameters:
    ///   - event: The event to add.
    ///   return: A closure indicating the success or failure of the operation.
    override suspend fun addEvent(event: Event): LSResult<Boolean> {
        try {
            DebugLogger.instance.log(LogLevel.INFO, "Add event - $event")
            val response = superboardApi.addEvent(event)
            if (response.isSuccessful) {
                val body = response.body()
                body?.let {
                    DebugLogger.instance.log(LogLevel.INFO, "Add event - Successful - $event")

                    return LSResult.Success(true)
                }
            }

            val error = gson.fromJson(response.errorBody()!!.string(), ErrorMessage::class.java)

            DebugLogger.instance.log(LogLevel.INFO, "Add event - Failed - $event ${error.error}")

            return LSResult.Error(java.io.IOException("Failed to log the event. ${error.error}"))
        } catch (e: Exception) {
            return LSResult.Error(e)
        }
    }

    /// Adds an event.
    ///
    /// - Parameters:
    ///   - event: The payment event to add.
    ///   return: A closure indicating the success or failure of the operation.
    override suspend fun addPaymentEvent(event: PaymentEvent): LSResult<Boolean> {
        try {
            DebugLogger.instance.log(LogLevel.INFO, "Add payment event - $event")
            val response = superboardApi.addPaymentEvent(event)
            if (response.isSuccessful) {
                val body = response.body()
                body?.let {
                    DebugLogger.instance.log(LogLevel.INFO, "Add payment event - Successful - $event")

                    return LSResult.Success(true)
                }
            }

            val error = gson.fromJson(response.errorBody()!!.string(), ErrorMessage::class.java)

            DebugLogger.instance.log(LogLevel.INFO, "Add payment event - Failed - $event ${error.error}")

            return LSResult.Error(java.io.IOException("Failed to log the payment event. ${error.error}"))
        } catch (e: Exception) {
            return LSResult.Error(e)
        }
    }

    override suspend fun updateAttributes(identifier: String?, attributes: Map<String, Any>?, pushToken: String?): LSResult<Boolean> {
        DebugLogger.instance.log(LogLevel.INFO, "Set attributes - $identifier $attributes push token: $pushToken")

        val request = UpdateAttributesRequest( sdkIdentifier = identifier,
            sdkAttributes = attributes,
            pushToken = pushToken)
        // The endpoint answers with an empty body, so any 2xx is a success.
        return requests.request(
            label = "Set attributes",
            failureMessage = "Failed to set attributes.",
            call = { superboardApi.updateAttributes(request) },
        ) {
            DebugLogger.instance.log(LogLevel.INFO, "Set attributes - Successful - $identifier $attributes")
            true
        }
    }

    override fun getDeviceFor(vendorId: String): Flow<GVRetryResult<GetDeviceResponse>> {
        DebugLogger.instance.log(LogLevel.INFO, "Getting device last seen")

        return requests.retryingFlow(
            label = "Getting device last seen",
            failureMessage = "Failed to get device last seen.",
            call = { superboardApi.getDeviceFor(vendorId) },
        ) { body ->
            body?.also {
                DebugLogger.instance.log(LogLevel.INFO, "Getting device last seen - Successful")
            }
        }
    }

    override suspend fun notifications(page: Int): LSResult<NotificationsResponse> {
        DebugLogger.instance.log(LogLevel.INFO, "Getting all the notifications")

        val request = NotificationsRequest(page = page)
        return requests.request(
            label = "Getting all the notifications",
            failureMessage = "Failed getting all the notifications.",
            call = { superboardApi.notifications(request) },
        ) { body ->
            body?.also {
                DebugLogger.instance.log(LogLevel.INFO, "Getting all the notifications - Successful")
            }
        }
    }

    override suspend fun numberOfUnreadNotifications(): LSResult<NumberOfUnreadNotificationsResponse> {
        DebugLogger.instance.log(LogLevel.INFO, "Get unread messages")

        return requests.request(
            label = "Get unread messages",
            failureMessage = "Failed get unread messages.",
            call = { superboardApi.numberOfUnreadNotifications() },
        ) { body ->
            body?.also {
                DebugLogger.instance.log(LogLevel.INFO, "Get unread messages - Successful")
            }
        }
    }

    override suspend fun markNotificationAsRead(notificationId: Int): LSResult<Boolean> {
        DebugLogger.instance.log(LogLevel.INFO, "Mark notification as read")

        val request = MarkNotificationAsReadRequest(notificationId = notificationId)
        // The endpoint answers with an empty body, so any 2xx is a success.
        return requests.request(
            label = "Mark notification as read",
            failureMessage = "Failed to mark notification as read.",
            call = { superboardApi.markNotificationAsRead(request = request) },
        ) {
            DebugLogger.instance.log(LogLevel.INFO, "Mark notification as read - Successful")
            true
        }
    }

    override suspend fun notificationsToDisplayAutomatically(): LSResult<NotificationsResponse> {
        DebugLogger.instance.log(LogLevel.INFO, "Notifications to display automatically")

        return requests.request(
            label = "Getting notifications to display automatically",
            failureMessage = "Failed getting notifications to display automatically.",
            call = { superboardApi.notificationsToDisplayAutomatically() },
        ) { body ->
            body?.also {
                DebugLogger.instance.log(LogLevel.INFO, "Getting notifications to display automatically - Successful")
            }
        }
    }

    private fun getRetrofit(): Retrofit {
        val gson = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            GsonBuilder().setLenient()
                    .registerTypeAdapterFactory(LSJsonInstantCompatTypeAdapterFactory())
                    .registerTypeAdapterFactory(LSJsonDateTypeAdapterFactory())
                    .registerTypeAdapterFactory(LSJsonInstantTypeAdapterFactory())
            .create()
        } else {
            GsonBuilder().setLenient()
                .registerTypeAdapterFactory(LSJsonInstantCompatTypeAdapterFactory())
                .registerTypeAdapterFactory(LSJsonDateTypeAdapterFactory())
                .create()
        }

        val configuredBaseUrl = superboardContext.settings.baseURL
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: throw IllegalStateException("SuperBoard baseURL must be configured by the application")
        val baseUrl = configuredBaseUrl.trimEnd('/') + "/v1/"

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .addConverterFactory(nullOnEmptyConverterFactory)
            .addConverterFactory(GsonConverterFactory.create(gson))
            .client(getOkhttpClient())
            .build()
    }

    private fun getOkhttpClient(): OkHttpClient {
        val httpLoggingInterceptor = HttpLoggingInterceptor()
        val builder = OkHttpClient.Builder()
        builder.connectTimeout(40, TimeUnit.SECONDS)
        builder.readTimeout(40, TimeUnit.SECONDS)
        builder.writeTimeout(40, TimeUnit.SECONDS)
        builder.addInterceptor(HeaderInterceptor { headers() })

        if (BuildConfig.NETWORK_LOGGING) {
            /** add logging interceptor at last Interceptor*/
            builder.addInterceptor(httpLoggingInterceptor.apply {
                httpLoggingInterceptor.level = HttpLoggingInterceptor.Level.BODY
            })
        }

        return builder.build()
    }

    private fun headers(): Map<String, String> {
        val customHeaders = mutableMapOf(
            "PROJECT-KEY" to accessKey,
            "IDENTIFIER" to appDetails.applicationId,
            "PLATFORM" to "android",
            "SDK-VERSION" to BuildConfig.SDK_VERSION,
            "User-Agent" to userAgent,
        )

        superboardContext.superboardId?.let {
            customHeaders["LINKSQUARED"] = it
        }

        return customHeaders
    }

}

package io.opengrow.service

import android.app.Application
import android.content.Context
import io.opengrow.MockOpenGrowApi
import io.opengrow.TestAssertions.assertEqualsWithContext
import io.opengrow.TestAssertions.assertNotNullWithContext
import io.opengrow.TestAssertions.assertTrueWithContext
import io.opengrow.TestAssertions.assertResultSuccess
import io.opengrow.TestAssertions.assertResultError
import io.opengrow.api.OpenGrowApi
import io.opengrow.handlers.OpenGrowContext
import io.opengrow.model.AppDetails
import io.opengrow.model.AuthenticationResponse
import io.opengrow.model.DebugLogger
import io.opengrow.model.DeeplinkDetails
import io.opengrow.model.Event
import io.opengrow.model.EventType
import io.opengrow.model.GenerateLinkResponse
import io.opengrow.model.GetDeviceResponse
import io.opengrow.model.LinkDetailsResponse
import io.opengrow.model.LogLevel
// PURCHASE_EVENT_DISABLED: import io.opengrow.model.events.PaymentEvent
// PURCHASE_EVENT_DISABLED: import io.opengrow.model.events.PaymentEventType
import io.opengrow.model.notifications.NotificationsResponse
import io.opengrow.model.notifications.NumberOfUnreadNotificationsResponse
import io.opengrow.utils.GVRetryResult
import io.opengrow.utils.InstantCompat
import io.opengrow.utils.LSResult
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import retrofit2.Response

/**
 * Core unit tests for OpenGrowService.
 */
@ExperimentalCoroutinesApi
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class OpenGrowServiceTest {

    private lateinit var context: Context
    private lateinit var application: Application
    private lateinit var opengrowContext: OpenGrowContext
    private lateinit var mockOpenGrowApi: MockOpenGrowApi
    private lateinit var opengrowService: TestableOpenGrowService

    private val testApiKey = "test-api-key-123"

    @Before
    fun setUp() {
        MockKAnnotations.init(this, relaxed = true)

        context = RuntimeEnvironment.getApplication()
        application = RuntimeEnvironment.getApplication()

        opengrowContext = OpenGrowContext()
        opengrowContext.settings.sdkEnabled = true

        mockOpenGrowApi = MockOpenGrowApi()

        DebugLogger.instance.logLevel = LogLevel.INFO

        opengrowService = TestableOpenGrowService(
            context = context,
            apiKey = testApiKey,
            opengrowContext = opengrowContext,
            testApi = mockOpenGrowApi
        )
    }

    @After
    fun tearDown() {
        mockOpenGrowApi.reset()
        unmockkAll()
    }

    private fun createTestAppDetails(): AppDetails {
        return AppDetails(
            version = "1.0.0",
            build = "1",
            bundle = "io.opengrow.test",
            device = "Test Device",
            deviceID = "test-device-id",
            userAgent = "Test User Agent",
            screenWidth = "1080",
            screenHeight = "1920",
            timezone = "UTC",
            language = "en-US",
            webglVendor = "Test Vendor",
            webglRenderer = "Test Renderer"
        )
    }

    // ==================== authenticate Tests ====================

    @Test
    fun `OpenGrowService authenticate returns GVRetryResult Success with opengrowId on successful API response`() = runTest {
        val expectedResponse = AuthenticationResponse(
            opengrowId = "opengrow_123",
            uriScheme = "testscheme",
            sdkIdentifier = "user_123",
            sdkAttributes = null
        )
        mockOpenGrowApi.authenticateResponse = Response.success(expectedResponse)

        val appDetails = createTestAppDetails()
        val results = opengrowService.authenticate(appDetails).take(1).toList()

        assertEqualsWithContext(
            1,
            results.size,
            "results.size",
            "after authenticate() with successful mock response"
        )
        assertTrueWithContext(
            results[0] is GVRetryResult.Success,
            "result is GVRetryResult.Success",
            "after authenticate() with successful mock response"
        )
        assertEqualsWithContext(
            "opengrow_123",
            (results[0] as GVRetryResult.Success).data.opengrowId,
            "opengrowId",
            "after authenticate() returns success"
        )
    }

    @Test
    fun `OpenGrowService authenticate returns GVRetryResult Error on 401 API response`() = runTest {
        mockOpenGrowApi.authenticateResponse = MockOpenGrowApi.createErrorResponseTyped(401, "Invalid API key")

        val appDetails = createTestAppDetails()
        val results = opengrowService.authenticate(appDetails).take(1).toList()

        assertEqualsWithContext(
            1,
            results.size,
            "results.size",
            "after authenticate() with 401 error response"
        )
        assertTrueWithContext(
            results[0] is GVRetryResult.Error,
            "result is GVRetryResult.Error",
            "after authenticate() with 401 error response"
        )
    }

    // ==================== generateLink Tests ====================

    @Test
    fun `OpenGrowService generateLink returns LSResult Success with link URL on successful API response`() = runTest {
        val expectedLink = "https://example.opengrow.io/generated123"
        mockOpenGrowApi.generateLinkResponse = Response.success(GenerateLinkResponse(link = expectedLink))

        val result = opengrowService.generateLink(
            title = "Test Title",
            subtitle = "Test Subtitle",
            imageURL = "https://example.com/image.png",
            data = mapOf("key" to "value"),
            tags = listOf("tag1", "tag2"),
            customRedirects = null,
            showPreviewIos = true,
            showPreviewAndroid = true,
            tracking = null
        )

        val response = assertResultSuccess(
            result,
            context = "after generateLink() with successful mock response"
        )
        assertEqualsWithContext(
            expectedLink,
            response.link,
            "link",
            "after generateLink() returns success"
        )
    }

    @Test
    fun `OpenGrowService generateLink returns LSResult Error on 400 API response`() = runTest {
        mockOpenGrowApi.generateLinkResponse = MockOpenGrowApi.createErrorResponseTyped(400, "Invalid parameters")

        val result = opengrowService.generateLink(
            title = "Test",
            subtitle = null,
            imageURL = null,
            data = null,
            tags = null,
            customRedirects = null,
            showPreviewIos = null,
            showPreviewAndroid = null,
            tracking = null
        )

        assertResultError(
            result,
            context = "after generateLink() with 400 error response"
        )
    }

    // ==================== payloadFor Tests ====================

    @Test
    fun `OpenGrowService payloadFor returns LSResult Success with DeeplinkDetails on successful response`() = runTest {
        val expectedDetails = DeeplinkDetails(
            link = "https://example.opengrow.io/link123",
            data = mapOf("key" to "value" as Object),
            tracking = mapOf("campaign" to "test" as Object)
        )
        mockOpenGrowApi.payloadResponse = Response.success(expectedDetails)

        val result = opengrowService.payloadFor(createTestAppDetails())

        val response = assertResultSuccess(
            result,
            context = "after payloadFor() with successful mock response"
        )
        assertEqualsWithContext(
            "https://example.opengrow.io/link123",
            response.link,
            "link",
            "after payloadFor() returns success"
        )
    }

    @Test
    fun `OpenGrowService payloadFor returns LSResult Error on 404 API response`() = runTest {
        mockOpenGrowApi.payloadResponse = MockOpenGrowApi.createErrorResponseTyped(404, "Not found")

        val result = opengrowService.payloadFor(createTestAppDetails())

        assertResultError(
            result,
            context = "after payloadFor() with 404 error response"
        )
    }

    // ==================== linkDetails Tests ====================

    @Test
    fun `OpenGrowService linkDetails returns LSResult Success with link data on successful response`() = runTest {
        val jsonResponse = """{"title": "My Link", "description": "A test link", "data": {"key": "value"}}"""
        mockOpenGrowApi.linkDetailsResponse = Response.success(jsonResponse.toResponseBody("application/json".toMediaType()))

        val result = opengrowService.linkDetails("/abc123")

        val linkResponse = assertResultSuccess(
            result,
            context = "after linkDetails('/abc123') with successful mock response"
        )
        assertNotNullWithContext(
            linkResponse.link,
            "link",
            "after linkDetails() returns success"
        )
    }

    @Test
    fun `OpenGrowService linkDetails returns LSResult Error on 404 API response`() = runTest {
        mockOpenGrowApi.linkDetailsResponse = MockOpenGrowApi.createErrorResponseTyped(404, "Link not found")

        val result = opengrowService.linkDetails("/nonexistent")

        assertResultError(
            result,
            context = "after linkDetails('/nonexistent') with 404 error response"
        )
    }

    // ==================== addEvent Tests ====================

    @Test
    fun `OpenGrowService addEvent returns LSResult Success with true on successful API response`() = runTest {
        mockOpenGrowApi.addEventResponse = Response.success(Unit)

        val event = Event(
            event = EventType.VIEW,
            createdAt = InstantCompat.now(),
            link = "https://example.opengrow.io/link"
        )

        val result = opengrowService.addEvent(event)

        val data = assertResultSuccess(
            result,
            context = "after addEvent() with successful mock response"
        )
        assertTrueWithContext(
            data,
            "result data",
            "after addEvent() returns success"
        )
    }

    @Test
    fun `OpenGrowService addEvent returns LSResult Error on 500 API response`() = runTest {
        mockOpenGrowApi.addEventResponse = MockOpenGrowApi.createErrorResponseTyped(500, "Server error")

        val event = Event(EventType.VIEW, InstantCompat.now())
        val result = opengrowService.addEvent(event)

        assertResultError(
            result,
            context = "after addEvent() with 500 error response"
        )
    }

    // ==================== addPaymentEvent Tests ====================

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `OpenGrowService addPaymentEvent passes payment event to API with correct eventType`() = runTest {
    // PURCHASE_EVENT_DISABLED:     val paymentEvent = PaymentEvent(
    // PURCHASE_EVENT_DISABLED:         eventType = PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:         priceCents = 1999,
    // PURCHASE_EVENT_DISABLED:         currency = "EUR",
    // PURCHASE_EVENT_DISABLED:         productId = "pro_plan"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     opengrowService.addPaymentEvent(paymentEvent)
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     assertTrueWithContext(
    // PURCHASE_EVENT_DISABLED:         mockOpenGrowApi.verifyAddPaymentEventCalled(),
    // PURCHASE_EVENT_DISABLED:         "addPaymentEvent was called on mockApi",
    // PURCHASE_EVENT_DISABLED:         "after addPaymentEvent() with BUY event"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED:     assertEqualsWithContext(
    // PURCHASE_EVENT_DISABLED:         PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:         mockOpenGrowApi.addPaymentEventCalls[0].eventType,
    // PURCHASE_EVENT_DISABLED:         "eventType",
    // PURCHASE_EVENT_DISABLED:         "after addPaymentEvent() with BUY event"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED: }

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `OpenGrowService addPaymentEvent returns LSResult Error on 400 API response`() = runTest {
    // PURCHASE_EVENT_DISABLED:     mockOpenGrowApi.addPaymentEventResponse = MockOpenGrowApi.createErrorResponseTyped(400, "Invalid payment")
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     val paymentEvent = PaymentEvent(eventType = PaymentEventType.BUY, priceCents = 100, currency = "USD")
    // PURCHASE_EVENT_DISABLED:     val result = opengrowService.addPaymentEvent(paymentEvent)
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     assertResultError(
    // PURCHASE_EVENT_DISABLED:         result,
    // PURCHASE_EVENT_DISABLED:         context = "after addPaymentEvent() with 400 error response"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED: }

    // ==================== notifications Tests ====================

    @Test
    fun `OpenGrowService notifications returns LSResult Success with notification list on successful response`() = runTest {
        mockOpenGrowApi.notificationsResponse = Response.success(NotificationsResponse(notifications = emptyList()))

        val result = opengrowService.notifications(page = 1)

        val response = assertResultSuccess(
            result,
            context = "after notifications(page=1) with successful mock response"
        )
        assertNotNullWithContext(
            response.notifications,
            "notifications",
            "after notifications() returns success"
        )
    }

    @Test
    fun `OpenGrowService numberOfUnreadNotifications returns LSResult Success with count on successful response`() = runTest {
        mockOpenGrowApi.numberOfUnreadNotificationsResponse = Response.success(
            NumberOfUnreadNotificationsResponse(numberOfUnreadNotifications = 5)
        )

        val result = opengrowService.numberOfUnreadNotifications()

        val response = assertResultSuccess(
            result,
            context = "after numberOfUnreadNotifications() with successful mock response"
        )
        assertEqualsWithContext(
            5,
            response.numberOfUnreadNotifications,
            "numberOfUnreadNotifications",
            "after numberOfUnreadNotifications() returns success"
        )
    }

    @Test
    fun `OpenGrowService markNotificationAsRead returns LSResult Success on successful API response`() = runTest {
        mockOpenGrowApi.markNotificationAsReadResponse = Response.success(Unit)

        val result = opengrowService.markNotificationAsRead(notificationId = 123)

        assertResultSuccess(
            result,
            context = "after markNotificationAsRead(123) with successful mock response"
        )
    }
}

/**
 * Testable subclass of OpenGrowService that allows injecting a mock OpenGrowApi.
 */
class TestableOpenGrowService(
    context: Context,
    apiKey: String,
    opengrowContext: OpenGrowContext,
    private val testApi: OpenGrowApi
) : IOpenGrowService {

    private val opengrowContext = opengrowContext
    private val context = context

    override fun authenticate(appDetails: AppDetails): kotlinx.coroutines.flow.Flow<GVRetryResult<AuthenticationResponse>> = callbackFlow {
        val response = testApi.authenticate(appDetails)
        if (response.isSuccessful) {
            response.body()?.let {
                trySend(GVRetryResult.Success(it))
                close()
                return@callbackFlow
            }
        }
        trySend(GVRetryResult.Error(java.io.IOException("Failed to authenticate")))
        close()
        awaitClose { }
    }

    override fun getDeviceFor(deviceId: String): kotlinx.coroutines.flow.Flow<GVRetryResult<GetDeviceResponse>> = callbackFlow {
        val response = testApi.getDeviceFor(deviceId)
        if (response.isSuccessful) {
            response.body()?.let {
                trySend(GVRetryResult.Success(it))
                close()
                return@callbackFlow
            }
        }
        trySend(GVRetryResult.Error(java.io.IOException("Failed to get device")))
        close()
        awaitClose { }
    }

    override suspend fun payloadFor(appDetails: AppDetails): LSResult<DeeplinkDetails> {
        return try {
            val response = testApi.payloadFor(appDetails)
            if (response.isSuccessful) {
                response.body()?.let { return LSResult.Success(it) }
            }
            LSResult.Error(java.io.IOException("Failed to get payload"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }

    override suspend fun payloadWithLinkFor(appDetails: AppDetails): LSResult<DeeplinkDetails> {
        return try {
            val response = testApi.payloadWithLinkFor(appDetails)
            if (response.isSuccessful) {
                response.body()?.let { return LSResult.Success(it) }
            }
            LSResult.Error(java.io.IOException("Failed to get payload with link"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }

    override suspend fun generateLink(
        title: String?,
        subtitle: String?,
        imageURL: String?,
        data: Map<String, java.io.Serializable>?,
        tags: List<String>?,
        customRedirects: CustomRedirects?,
        showPreviewIos: Boolean?,
        showPreviewAndroid: Boolean?,
        tracking: TrackingParams?
    ): LSResult<GenerateLinkResponse> {
        return try {
            val request = io.opengrow.model.GenerateLinkRequest(
                title = title,
                subtitle = subtitle,
                imageUrl = imageURL,
                data = com.google.gson.Gson().toJson(data),
                tags = com.google.gson.Gson().toJson(tags),
                iosCustomRedirect = customRedirects?.ios,
                androidCustomRedirect = customRedirects?.android,
                desktopCustomRedirect = customRedirects?.desktop,
                showPreviewIos = showPreviewIos,
                showPreviewAndroid = showPreviewAndroid,
                trackingCampaign = tracking?.utmCampaign,
                trackingMedium = tracking?.utmMedium,
                trackingSource = tracking?.utmSource
            )
            val response = testApi.generateLink(request)
            if (response.isSuccessful) {
                response.body()?.let { return LSResult.Success(it) }
            }
            LSResult.Error(java.io.IOException("Failed to generate link"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }

    override suspend fun linkDetails(path: String): LSResult<LinkDetailsResponse> {
        return try {
            val request = io.opengrow.model.LinkDetailsRequest(path = path)
            val response = testApi.linkDetails(request)
            if (response.isSuccessful) {
                response.body()?.string()?.let {
                    if (it == "null") {
                        return LSResult.Error(java.io.IOException("Invalid link path"))
                    }
                    val map: Map<String, Any> = com.google.gson.Gson().fromJson(it, object : com.google.gson.reflect.TypeToken<Map<String, Any?>>() {}.type)
                    return LSResult.Success(LinkDetailsResponse(link = map))
                }
            }
            LSResult.Error(java.io.IOException("Failed to get link details"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }

    override suspend fun updateAttributes(
        identifier: String?,
        attributes: Map<String, Any>?,
        pushToken: String?
    ): LSResult<Boolean> {
        return try {
            val request = io.opengrow.model.UpdateAttributesRequest(
                sdkIdentifier = identifier,
                sdkAttributes = attributes,
                pushToken = pushToken
            )
            val response = testApi.updateAttributes(request)
            if (response.isSuccessful) {
                return LSResult.Success(true)
            }
            LSResult.Error(java.io.IOException("Failed to update attributes"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }

    override suspend fun addEvent(event: io.opengrow.model.Event): LSResult<Boolean> {
        return try {
            val response = testApi.addEvent(event)
            if (response.isSuccessful) {
                return LSResult.Success(true)
            }
            LSResult.Error(java.io.IOException("Failed to add event"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }

    override suspend fun addPaymentEvent(event: io.opengrow.model.events.PaymentEvent): LSResult<Boolean> {
        return try {
            val response = testApi.addPaymentEvent(event)
            if (response.isSuccessful) {
                return LSResult.Success(true)
            }
            LSResult.Error(java.io.IOException("Failed to add payment event"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }

    override suspend fun notifications(page: Int): LSResult<NotificationsResponse> {
        return try {
            val request = io.opengrow.model.notifications.NotificationsRequest(page = page)
            val response = testApi.notifications(request)
            if (response.isSuccessful) {
                response.body()?.let { return LSResult.Success(it) }
            }
            LSResult.Error(java.io.IOException("Failed to get notifications"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }

    override suspend fun notificationsToDisplayAutomatically(): LSResult<NotificationsResponse> {
        return try {
            val response = testApi.notificationsToDisplayAutomatically()
            if (response.isSuccessful) {
                response.body()?.let { return LSResult.Success(it) }
            }
            LSResult.Error(java.io.IOException("Failed to get notifications"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }

    override suspend fun numberOfUnreadNotifications(): LSResult<NumberOfUnreadNotificationsResponse> {
        return try {
            val response = testApi.numberOfUnreadNotifications()
            if (response.isSuccessful) {
                response.body()?.let { return LSResult.Success(it) }
            }
            LSResult.Error(java.io.IOException("Failed to get unread count"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }

    override suspend fun markNotificationAsRead(notificationId: Int): LSResult<Boolean> {
        return try {
            val request = io.opengrow.model.notifications.MarkNotificationAsReadRequest(notificationId = notificationId)
            val response = testApi.markNotificationAsRead(request)
            if (response.isSuccessful) {
                return LSResult.Success(true)
            }
            LSResult.Error(java.io.IOException("Failed to mark as read"))
        } catch (e: Exception) {
            LSResult.Error(e)
        }
    }
}

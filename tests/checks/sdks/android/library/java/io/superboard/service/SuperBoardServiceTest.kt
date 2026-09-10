package io.superboard.service

import android.app.Application
import android.content.Context
import io.superboard.MockSuperBoardApi
import io.superboard.TestAssertions.assertEqualsWithContext
import io.superboard.TestAssertions.assertNotNullWithContext
import io.superboard.TestAssertions.assertTrueWithContext
import io.superboard.TestAssertions.assertResultSuccess
import io.superboard.TestAssertions.assertResultError
import io.superboard.api.SuperBoardApi
import io.superboard.handlers.SuperBoardContext
import io.superboard.model.AppDetails
import io.superboard.model.AuthenticationResponse
import io.superboard.model.DebugLogger
import io.superboard.model.DeeplinkDetails
import io.superboard.model.Event
import io.superboard.model.EventType
import io.superboard.model.GenerateLinkResponse
import io.superboard.model.GetDeviceResponse
import io.superboard.model.LinkDetailsResponse
import io.superboard.model.LogLevel
// PURCHASE_EVENT_DISABLED: import io.superboard.model.events.PaymentEvent
// PURCHASE_EVENT_DISABLED: import io.superboard.model.events.PaymentEventType
import io.superboard.model.notifications.NotificationsResponse
import io.superboard.model.notifications.NumberOfUnreadNotificationsResponse
import io.superboard.utils.GVRetryResult
import io.superboard.utils.InstantCompat
import io.superboard.utils.LSResult
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
 * Core unit tests for SuperBoardService.
 */
@ExperimentalCoroutinesApi
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class SuperBoardServiceTest {

    private lateinit var context: Context
    private lateinit var application: Application
    private lateinit var superboardContext: SuperBoardContext
    private lateinit var mockSuperBoardApi: MockSuperBoardApi
    private lateinit var superboardService: TestableSuperBoardService

    private val testApiKey = "test-api-key-123"

    @Before
    fun setUp() {
        MockKAnnotations.init(this, relaxed = true)

        context = RuntimeEnvironment.getApplication()
        application = RuntimeEnvironment.getApplication()

        superboardContext = SuperBoardContext()
        superboardContext.settings.sdkEnabled = true

        mockSuperBoardApi = MockSuperBoardApi()

        DebugLogger.instance.logLevel = LogLevel.INFO

        superboardService = TestableSuperBoardService(
            context = context,
            apiKey = testApiKey,
            superboardContext = superboardContext,
            testApi = mockSuperBoardApi
        )
    }

    @After
    fun tearDown() {
        mockSuperBoardApi.reset()
        unmockkAll()
    }

    private fun createTestAppDetails(): AppDetails {
        return AppDetails(
            version = "1.0.0",
            build = "1",
            bundle = "io.superboard.test",
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
    fun `SuperBoardService authenticate returns GVRetryResult Success with superboardId on successful API response`() = runTest {
        val expectedResponse = AuthenticationResponse(
            superboardId = "superboard_123",
            uriScheme = "testscheme",
            sdkIdentifier = "user_123",
            sdkAttributes = null
        )
        mockSuperBoardApi.authenticateResponse = Response.success(expectedResponse)

        val appDetails = createTestAppDetails()
        val results = superboardService.authenticate(appDetails).take(1).toList()

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
            "superboard_123",
            (results[0] as GVRetryResult.Success).data.superboardId,
            "superboardId",
            "after authenticate() returns success"
        )
    }

    @Test
    fun `SuperBoardService authenticate returns GVRetryResult Error on 401 API response`() = runTest {
        mockSuperBoardApi.authenticateResponse = MockSuperBoardApi.createErrorResponseTyped(401, "Invalid API key")

        val appDetails = createTestAppDetails()
        val results = superboardService.authenticate(appDetails).take(1).toList()

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
    fun `SuperBoardService generateLink returns LSResult Success with link URL on successful API response`() = runTest {
        val expectedLink = "https://example.superboard.io/generated123"
        mockSuperBoardApi.generateLinkResponse = Response.success(GenerateLinkResponse(link = expectedLink))

        val result = superboardService.generateLink(
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
    fun `SuperBoardService generateLink returns LSResult Error on 400 API response`() = runTest {
        mockSuperBoardApi.generateLinkResponse = MockSuperBoardApi.createErrorResponseTyped(400, "Invalid parameters")

        val result = superboardService.generateLink(
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
    fun `SuperBoardService payloadFor returns LSResult Success with DeeplinkDetails on successful response`() = runTest {
        val expectedDetails = DeeplinkDetails(
            link = "https://example.superboard.io/link123",
            data = mapOf("key" to "value" as Object),
            tracking = mapOf("campaign" to "test" as Object)
        )
        mockSuperBoardApi.payloadResponse = Response.success(expectedDetails)

        val result = superboardService.payloadFor(createTestAppDetails())

        val response = assertResultSuccess(
            result,
            context = "after payloadFor() with successful mock response"
        )
        assertEqualsWithContext(
            "https://example.superboard.io/link123",
            response.link,
            "link",
            "after payloadFor() returns success"
        )
    }

    @Test
    fun `SuperBoardService payloadFor returns LSResult Error on 404 API response`() = runTest {
        mockSuperBoardApi.payloadResponse = MockSuperBoardApi.createErrorResponseTyped(404, "Not found")

        val result = superboardService.payloadFor(createTestAppDetails())

        assertResultError(
            result,
            context = "after payloadFor() with 404 error response"
        )
    }

    // ==================== linkDetails Tests ====================

    @Test
    fun `SuperBoardService linkDetails returns LSResult Success with link data on successful response`() = runTest {
        val jsonResponse = """{"title": "My Link", "description": "A test link", "data": {"key": "value"}}"""
        mockSuperBoardApi.linkDetailsResponse = Response.success(jsonResponse.toResponseBody("application/json".toMediaType()))

        val result = superboardService.linkDetails("/abc123")

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
    fun `SuperBoardService linkDetails returns LSResult Error on 404 API response`() = runTest {
        mockSuperBoardApi.linkDetailsResponse = MockSuperBoardApi.createErrorResponseTyped(404, "Link not found")

        val result = superboardService.linkDetails("/nonexistent")

        assertResultError(
            result,
            context = "after linkDetails('/nonexistent') with 404 error response"
        )
    }

    // ==================== addEvent Tests ====================

    @Test
    fun `SuperBoardService addEvent returns LSResult Success with true on successful API response`() = runTest {
        mockSuperBoardApi.addEventResponse = Response.success(Unit)

        val event = Event(
            event = EventType.VIEW,
            createdAt = InstantCompat.now(),
            link = "https://example.superboard.io/link"
        )

        val result = superboardService.addEvent(event)

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
    fun `SuperBoardService addEvent returns LSResult Error on 500 API response`() = runTest {
        mockSuperBoardApi.addEventResponse = MockSuperBoardApi.createErrorResponseTyped(500, "Server error")

        val event = Event(EventType.VIEW, InstantCompat.now())
        val result = superboardService.addEvent(event)

        assertResultError(
            result,
            context = "after addEvent() with 500 error response"
        )
    }

    // ==================== addPaymentEvent Tests ====================

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `SuperBoardService addPaymentEvent passes payment event to API with correct eventType`() = runTest {
    // PURCHASE_EVENT_DISABLED:     val paymentEvent = PaymentEvent(
    // PURCHASE_EVENT_DISABLED:         eventType = PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:         priceCents = 1999,
    // PURCHASE_EVENT_DISABLED:         currency = "EUR",
    // PURCHASE_EVENT_DISABLED:         productId = "pro_plan"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     superboardService.addPaymentEvent(paymentEvent)
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     assertTrueWithContext(
    // PURCHASE_EVENT_DISABLED:         mockSuperBoardApi.verifyAddPaymentEventCalled(),
    // PURCHASE_EVENT_DISABLED:         "addPaymentEvent was called on mockApi",
    // PURCHASE_EVENT_DISABLED:         "after addPaymentEvent() with BUY event"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED:     assertEqualsWithContext(
    // PURCHASE_EVENT_DISABLED:         PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:         mockSuperBoardApi.addPaymentEventCalls[0].eventType,
    // PURCHASE_EVENT_DISABLED:         "eventType",
    // PURCHASE_EVENT_DISABLED:         "after addPaymentEvent() with BUY event"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED: }

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `SuperBoardService addPaymentEvent returns LSResult Error on 400 API response`() = runTest {
    // PURCHASE_EVENT_DISABLED:     mockSuperBoardApi.addPaymentEventResponse = MockSuperBoardApi.createErrorResponseTyped(400, "Invalid payment")
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     val paymentEvent = PaymentEvent(eventType = PaymentEventType.BUY, priceCents = 100, currency = "USD")
    // PURCHASE_EVENT_DISABLED:     val result = superboardService.addPaymentEvent(paymentEvent)
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     assertResultError(
    // PURCHASE_EVENT_DISABLED:         result,
    // PURCHASE_EVENT_DISABLED:         context = "after addPaymentEvent() with 400 error response"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED: }

    // ==================== notifications Tests ====================

    @Test
    fun `SuperBoardService notifications returns LSResult Success with notification list on successful response`() = runTest {
        mockSuperBoardApi.notificationsResponse = Response.success(NotificationsResponse(notifications = emptyList()))

        val result = superboardService.notifications(page = 1)

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
    fun `SuperBoardService numberOfUnreadNotifications returns LSResult Success with count on successful response`() = runTest {
        mockSuperBoardApi.numberOfUnreadNotificationsResponse = Response.success(
            NumberOfUnreadNotificationsResponse(numberOfUnreadNotifications = 5)
        )

        val result = superboardService.numberOfUnreadNotifications()

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
    fun `SuperBoardService markNotificationAsRead returns LSResult Success on successful API response`() = runTest {
        mockSuperBoardApi.markNotificationAsReadResponse = Response.success(Unit)

        val result = superboardService.markNotificationAsRead(notificationId = 123)

        assertResultSuccess(
            result,
            context = "after markNotificationAsRead(123) with successful mock response"
        )
    }
}

/**
 * Testable subclass of SuperBoardService that allows injecting a mock SuperBoardApi.
 */
class TestableSuperBoardService(
    context: Context,
    apiKey: String,
    superboardContext: SuperBoardContext,
    private val testApi: SuperBoardApi
) : ISuperBoardService {

    private val superboardContext = superboardContext
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
            val request = io.superboard.model.GenerateLinkRequest(
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
            val request = io.superboard.model.LinkDetailsRequest(path = path)
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
            val request = io.superboard.model.UpdateAttributesRequest(
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

    override suspend fun addEvent(event: io.superboard.model.Event): LSResult<Boolean> {
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

    override suspend fun addPaymentEvent(event: io.superboard.model.events.PaymentEvent): LSResult<Boolean> {
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
            val request = io.superboard.model.notifications.NotificationsRequest(page = page)
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
            val request = io.superboard.model.notifications.MarkNotificationAsReadRequest(notificationId = notificationId)
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

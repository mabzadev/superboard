package io.opengrow.handlers

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import io.opengrow.TestAssertions.assertAuthenticated
import io.opengrow.TestAssertions.assertUnauthenticated
import io.opengrow.TestAssertions.assertEqualsWithContext
import io.opengrow.TestAssertions.assertNotNullWithContext
import io.opengrow.TestAssertions.assertNullWithContext
import io.opengrow.TestAssertions.assertResultSuccess
import io.opengrow.TestAssertions.assertResultError
import io.opengrow.TestAssertions.assertResultErrorContains
import io.opengrow.model.AppDetails
import io.opengrow.model.DebugLogger
import io.opengrow.model.DeeplinkDetails
import io.opengrow.model.GenerateLinkResponse
import io.opengrow.model.LinkDetailsResponse
import io.opengrow.model.LogLevel
// PURCHASE_EVENT_DISABLED: import io.opengrow.model.events.PaymentEventType
import io.opengrow.service.IOpenGrowService
import io.opengrow.utils.IAppDetailsHelper
import io.opengrow.utils.LSResult
import io.mockk.*
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.Serializable

/**
 * Core unit tests for OpenGrowManager.
 */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class OpenGrowManagerTest {

    private lateinit var context: Context
    private lateinit var application: Application
    private lateinit var opengrowContext: OpenGrowContext
    private lateinit var mockOpenGrowService: IOpenGrowService
    private lateinit var mockEventsManager: IEventsManager
    private lateinit var mockAppDetailsHelper: IAppDetailsHelper
    private lateinit var opengrowManager: OpenGrowManager

    private val testApiKey = "test-api-key-123"

    @Before
    fun setUp() {
        MockKAnnotations.init(this, relaxed = true)

        context = RuntimeEnvironment.getApplication()
        application = RuntimeEnvironment.getApplication()

        opengrowContext = OpenGrowContext()
        opengrowContext.settings.sdkEnabled = true

        mockOpenGrowService = mockk(relaxed = true)
        mockEventsManager = mockk(relaxed = true)
        mockAppDetailsHelper = mockk(relaxed = true)

        coEvery { mockAppDetailsHelper.toAppDetails() } returns createMockAppDetails()
        every { mockAppDetailsHelper.deviceID } returns "test-device-id"
        every { mockAppDetailsHelper.versionName } returns "1.0.0"
        every { mockAppDetailsHelper.versionCode } returns 1
        every { mockAppDetailsHelper.applicationId } returns "io.opengrow.test"
        every { mockAppDetailsHelper.device } returns "Test Device"

        DebugLogger.instance.logLevel = LogLevel.INFO

        opengrowManager = OpenGrowManager(
            context = context,
            application = application,
            opengrowContext = opengrowContext,
            apiKey = testApiKey,
            opengrowService = mockOpenGrowService,
            eventsManager = mockEventsManager,
            appDetailsHelper = mockAppDetailsHelper
        )
    }

    private fun createMockAppDetails(): AppDetails {
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

    @After
    fun tearDown() {
        unmockkAll()
    }

    // ==================== Authentication State Tests ====================

    @Test
    fun `OpenGrowManager authenticationState is UNAUTHENTICATED when newly constructed`() {
        assertUnauthenticated(
            opengrowManager,
            context = "after construction with default settings"
        )
    }

    // ==================== Properties Tests ====================

    @Test
    fun `OpenGrowManager identifier property updates opengrowContext when set`() {
        opengrowManager.identifier = "user-123"

        assertEqualsWithContext(
            "user-123",
            opengrowContext.identifier,
            "opengrowContext.identifier",
            "after setting opengrowManager.identifier='user-123'"
        )
    }

    @Test
    fun `OpenGrowManager pushToken property updates opengrowContext when set`() {
        opengrowManager.pushToken = "fcm-token-xyz"

        assertEqualsWithContext(
            "fcm-token-xyz",
            opengrowContext.pushToken,
            "opengrowContext.pushToken",
            "after setting opengrowManager.pushToken='fcm-token-xyz'"
        )
    }

    @Test
    fun `OpenGrowManager attributes property updates opengrowContext when set`() {
        val attrs = mapOf("key1" to "value1", "key2" to 42)

        opengrowManager.attributes = attrs

        assertEqualsWithContext(
            attrs,
            opengrowContext.attributes,
            "opengrowContext.attributes",
            "after setting opengrowManager.attributes with key1='value1', key2=42"
        )
    }

    // ==================== Lifecycle Tests ====================

    @Test
    fun `OpenGrowManager onAppForegrounded delegates to eventsManager`() = runTest {
        opengrowManager.onAppForegrounded()

        coVerify { mockEventsManager.onAppForegrounded() }
    }

    @Test
    fun `OpenGrowManager onAppBackgrounded delegates to eventsManager`() {
        opengrowManager.onAppBackgrounded()

        verify { mockEventsManager.onAppBackgrounded() }
    }

    // ==================== Generate Link Tests ====================

    @Test
    fun `OpenGrowManager generateLink returns LSResult Error when SDK is disabled`() = runTest {
        opengrowContext.settings.sdkEnabled = false

        val result = opengrowManager.generateLink(
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
            context = "after generateLink() with sdkEnabled=false"
        )
    }

    @Test
    fun `OpenGrowManager generateLink returns LSResult Error with not ready message when unauthenticated`() = runTest {
        assertUnauthenticated(opengrowManager, context = "before generateLink() call")

        val result = opengrowManager.generateLink(
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

        assertResultErrorContains(
            result,
            expectedMessageContains = "not ready",
            context = "after generateLink() with UNAUTHENTICATED state"
        )
    }

    @Test
    fun `OpenGrowManager generateLink calls service and returns Success when authenticated`() = runTest {
        opengrowManager.authenticationState = OpenGrowManager.AuthenticationState.AUTHENTICATED

        val expectedResponse = GenerateLinkResponse(
            link = "https://test.opengrow.io/abc123"
        )

        coEvery {
            mockOpenGrowService.generateLink(
                title = any(),
                subtitle = any(),
                imageURL = any(),
                data = any(),
                tags = any(),
                customRedirects = any(),
                showPreviewIos = any(),
                showPreviewAndroid = any(),
                tracking = any()
            )
        } returns LSResult.Success(expectedResponse)

        val result = opengrowManager.generateLink(
            title = "Test Link",
            subtitle = "Subtitle",
            imageURL = "https://example.com/image.png",
            data = mapOf("key" to "value" as Serializable),
            tags = listOf("tag1", "tag2"),
            customRedirects = null,
            showPreviewIos = true,
            showPreviewAndroid = false,
            tracking = null
        )

        val response = assertResultSuccess(
            result,
            context = "after generateLink() with AUTHENTICATED state"
        )
        assertEqualsWithContext(
            "https://test.opengrow.io/abc123",
            response.link,
            "link",
            "after generateLink() returns success"
        )

        coVerify {
            mockOpenGrowService.generateLink(
                title = "Test Link",
                subtitle = "Subtitle",
                imageURL = "https://example.com/image.png",
                data = any(),
                tags = listOf("tag1", "tag2"),
                customRedirects = null,
                showPreviewIos = true,
                showPreviewAndroid = false,
                tracking = null
            )
        }
    }

    // ==================== Link Details Tests ====================

    @Test
    fun `OpenGrowManager linkDetails returns LSResult Error when SDK is disabled`() = runTest {
        opengrowContext.settings.sdkEnabled = false

        val result = opengrowManager.linkDetails("/test-path")

        assertResultError(
            result,
            context = "after linkDetails() with sdkEnabled=false"
        )
    }

    @Test
    fun `OpenGrowManager linkDetails calls service and returns Success when authenticated`() = runTest {
        opengrowManager.authenticationState = OpenGrowManager.AuthenticationState.AUTHENTICATED

        val expectedResponse = LinkDetailsResponse(
            link = mapOf("url" to "https://test.opengrow.io/path", "title" to "Test Title")
        )

        coEvery { mockOpenGrowService.linkDetails(any()) } returns LSResult.Success(expectedResponse)

        val result = opengrowManager.linkDetails("/path")

        val response = assertResultSuccess(
            result,
            context = "after linkDetails('/path') with AUTHENTICATED state"
        )
        assertEqualsWithContext(
            "Test Title",
            response.link["title"],
            "link['title']",
            "after linkDetails() returns success"
        )

        coVerify { mockOpenGrowService.linkDetails("/path") }
    }

    // ==================== Handle Intent Tests ====================

    @Test
    fun `OpenGrowManager handleIntent returns null when not authenticated`() = runTest {
        val intent = Intent()

        val result = opengrowManager.handleIntent(intent, delayEvents = false)

        assertNullWithContext(
            result,
            "handleIntent result",
            "after handleIntent() with UNAUTHENTICATED state"
        )
    }

    @Test
    fun `OpenGrowManager handleIntent with data URI calls payloadWithLinkFor and returns DeeplinkDetails`() = runTest {
        opengrowManager.authenticationState = OpenGrowManager.AuthenticationState.AUTHENTICATED

        val intent = Intent().apply {
            data = Uri.parse("https://test.opengrow.io/deep/link")
        }

        val expectedDetails = DeeplinkDetails(
            link = "https://test.opengrow.io/deep/link",
            data = mapOf("key" to "value" as Object),
            tracking = null
        )

        coEvery { mockOpenGrowService.payloadWithLinkFor(any()) } returns LSResult.Success(expectedDetails)
        coEvery { mockEventsManager.setLinkToNewFutureActions(any(), any()) } just Runs

        val result = opengrowManager.handleIntent(intent, delayEvents = false)

        assertNotNullWithContext(
            result,
            "handleIntent result",
            "after handleIntent() with data URI and AUTHENTICATED state"
        )
        assertEqualsWithContext(
            "https://test.opengrow.io/deep/link",
            result?.link,
            "link",
            "after handleIntent() with data URI"
        )

        coVerify { mockEventsManager.setLinkToNewFutureActions(any(), delayEvents = false) }
        coVerify { mockOpenGrowService.payloadWithLinkFor(any()) }
    }

    @Test
    fun `OpenGrowManager handleIntent returns DeeplinkDetails with data and tracking when present`() = runTest {
        opengrowManager.authenticationState = OpenGrowManager.AuthenticationState.AUTHENTICATED

        val intent = Intent().apply {
            data = Uri.parse("https://test.opengrow.io/promo")
        }

        val expectedDetails = DeeplinkDetails(
            link = "https://test.opengrow.io/promo",
            data = mapOf("promo" to "summer2024" as Object),
            tracking = mapOf("campaign" to "email" as Object)
        )

        coEvery { mockOpenGrowService.payloadWithLinkFor(any()) } returns LSResult.Success(expectedDetails)
        coEvery { mockEventsManager.setLinkToNewFutureActions(any(), any()) } just Runs

        val result = opengrowManager.handleIntent(intent, delayEvents = false)

        assertNotNullWithContext(
            result,
            "handleIntent result",
            "after handleIntent() with promo link"
        )
        assertEqualsWithContext(
            "https://test.opengrow.io/promo",
            result?.link,
            "link",
            "after handleIntent() with promo link"
        )
        assertEqualsWithContext(
            "summer2024",
            result?.data?.get("promo"),
            "data['promo']",
            "after handleIntent() with promo data"
        )
        assertEqualsWithContext(
            "email",
            result?.tracking?.get("campaign"),
            "tracking['campaign']",
            "after handleIntent() with tracking data"
        )
    }

    @Test
    fun `OpenGrowManager handleIntent returns null when service returns error`() = runTest {
        opengrowManager.authenticationState = OpenGrowManager.AuthenticationState.AUTHENTICATED

        val intent = Intent().apply {
            data = Uri.parse("https://test.opengrow.io/error")
        }

        coEvery { mockOpenGrowService.payloadWithLinkFor(any()) } returns LSResult.Error(Exception("Network error"))
        coEvery { mockEventsManager.setLinkToNewFutureActions(any(), any()) } just Runs

        val result = opengrowManager.handleIntent(intent, delayEvents = false)

        assertNullWithContext(
            result,
            "handleIntent result",
            "after handleIntent() when service returns error"
        )
    }

    @Test
    fun `OpenGrowManager handleIntent updates eventsManager linkForFutureActions on success`() = runTest {
        opengrowManager.authenticationState = OpenGrowManager.AuthenticationState.AUTHENTICATED

        val intent = Intent().apply {
            data = Uri.parse("https://test.opengrow.io/track")
        }

        val expectedDetails = DeeplinkDetails(
            link = "https://test.opengrow.io/resolved-link",
            data = mapOf("key" to "value" as Object),
            tracking = null
        )

        coEvery { mockOpenGrowService.payloadWithLinkFor(any()) } returns LSResult.Success(expectedDetails)
        coEvery { mockEventsManager.setLinkToNewFutureActions(any(), any()) } just Runs

        opengrowManager.handleIntent(intent, delayEvents = false)

        coVerify { mockEventsManager.setLinkToNewFutureActions("https://test.opengrow.io/resolved-link", delayEvents = false) }
    }

    // ==================== Payment Events Tests ====================

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `OpenGrowManager logInAppPurchase delegates to eventsManager`() = runTest {
    // PURCHASE_EVENT_DISABLED:     val originalJson = """{"orderId": "test123", "productId": "premium"}"""
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     coEvery { mockEventsManager.logInAppPurchase(any()) } just Runs
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     opengrowManager.logInAppPurchase(originalJson)
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     coVerify { mockEventsManager.logInAppPurchase(originalJson) }
    // PURCHASE_EVENT_DISABLED: }

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `OpenGrowManager logCustomPurchase delegates to eventsManager with correct parameters`() = runTest {
    // PURCHASE_EVENT_DISABLED:     coEvery {
    // PURCHASE_EVENT_DISABLED:         mockEventsManager.logCustomPurchase(any(), any(), any(), any(), any())
    // PURCHASE_EVENT_DISABLED:     } just Runs
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     opengrowManager.logCustomPurchase(
    // PURCHASE_EVENT_DISABLED:         type = PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:         priceInCents = 999,
    // PURCHASE_EVENT_DISABLED:         currency = "USD",
    // PURCHASE_EVENT_DISABLED:         productId = "premium_feature"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     coVerify {
    // PURCHASE_EVENT_DISABLED:         mockEventsManager.logCustomPurchase(
    // PURCHASE_EVENT_DISABLED:             type = PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:             priceInCents = 999,
    // PURCHASE_EVENT_DISABLED:             currency = "USD",
    // PURCHASE_EVENT_DISABLED:             productId = "premium_feature",
    // PURCHASE_EVENT_DISABLED:             startDate = any()
    // PURCHASE_EVENT_DISABLED:         )
    // PURCHASE_EVENT_DISABLED:     }
    // PURCHASE_EVENT_DISABLED: }

    // ==================== Edge Cases Tests ====================

    @Test
    fun `OpenGrowManager identifier property can be set to null after being set`() {
        opengrowContext.identifier = "existing-user"
        assertEqualsWithContext(
            "existing-user",
            opengrowManager.identifier,
            "identifier",
            "after setting opengrowContext.identifier"
        )

        opengrowManager.identifier = null

        assertNullWithContext(
            opengrowManager.identifier,
            "identifier",
            "after setting opengrowManager.identifier=null"
        )
        assertNullWithContext(
            opengrowContext.identifier,
            "opengrowContext.identifier",
            "after setting opengrowManager.identifier=null"
        )
    }

    @Test
    fun `OpenGrowManager handleIntent returns null when DeeplinkDetails has null link and null data`() = runTest {
        opengrowManager.authenticationState = OpenGrowManager.AuthenticationState.AUTHENTICATED

        val intent = Intent()

        val emptyDetails = DeeplinkDetails(
            link = null,
            data = null,
            tracking = null
        )

        coEvery { mockOpenGrowService.payloadFor(any()) } returns LSResult.Success(emptyDetails)
        coEvery { mockEventsManager.setLinkToNewFutureActions(any(), any()) } just Runs

        val result = opengrowManager.handleIntent(intent, delayEvents = false)

        assertNullWithContext(
            result,
            "handleIntent result",
            "after handleIntent() when DeeplinkDetails has null link and data"
        )
    }
}

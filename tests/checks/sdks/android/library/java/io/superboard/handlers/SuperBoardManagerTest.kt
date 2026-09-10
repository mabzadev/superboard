package io.superboard.handlers

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import io.superboard.TestAssertions.assertAuthenticated
import io.superboard.TestAssertions.assertUnauthenticated
import io.superboard.TestAssertions.assertEqualsWithContext
import io.superboard.TestAssertions.assertNotNullWithContext
import io.superboard.TestAssertions.assertNullWithContext
import io.superboard.TestAssertions.assertResultSuccess
import io.superboard.TestAssertions.assertResultError
import io.superboard.TestAssertions.assertResultErrorContains
import io.superboard.model.AppDetails
import io.superboard.model.DebugLogger
import io.superboard.model.DeeplinkDetails
import io.superboard.model.GenerateLinkResponse
import io.superboard.model.LinkDetailsResponse
import io.superboard.model.LogLevel
// PURCHASE_EVENT_DISABLED: import io.superboard.model.events.PaymentEventType
import io.superboard.service.ISuperBoardService
import io.superboard.utils.IAppDetailsHelper
import io.superboard.utils.LSResult
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
 * Core unit tests for SuperBoardManager.
 */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class SuperBoardManagerTest {

    private lateinit var context: Context
    private lateinit var application: Application
    private lateinit var superboardContext: SuperBoardContext
    private lateinit var mockSuperBoardService: ISuperBoardService
    private lateinit var mockEventsManager: IEventsManager
    private lateinit var mockAppDetailsHelper: IAppDetailsHelper
    private lateinit var superboardManager: SuperBoardManager

    private val testApiKey = "test-api-key-123"

    @Before
    fun setUp() {
        MockKAnnotations.init(this, relaxed = true)

        context = RuntimeEnvironment.getApplication()
        application = RuntimeEnvironment.getApplication()

        superboardContext = SuperBoardContext()
        superboardContext.settings.sdkEnabled = true

        mockSuperBoardService = mockk(relaxed = true)
        mockEventsManager = mockk(relaxed = true)
        mockAppDetailsHelper = mockk(relaxed = true)

        coEvery { mockAppDetailsHelper.toAppDetails() } returns createMockAppDetails()
        every { mockAppDetailsHelper.deviceID } returns "test-device-id"
        every { mockAppDetailsHelper.versionName } returns "1.0.0"
        every { mockAppDetailsHelper.versionCode } returns 1
        every { mockAppDetailsHelper.applicationId } returns "io.superboard.test"
        every { mockAppDetailsHelper.device } returns "Test Device"

        DebugLogger.instance.logLevel = LogLevel.INFO

        superboardManager = SuperBoardManager(
            context = context,
            application = application,
            superboardContext = superboardContext,
            apiKey = testApiKey,
            superboardService = mockSuperBoardService,
            eventsManager = mockEventsManager,
            appDetailsHelper = mockAppDetailsHelper
        )
    }

    private fun createMockAppDetails(): AppDetails {
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

    @After
    fun tearDown() {
        unmockkAll()
    }

    // ==================== Authentication State Tests ====================

    @Test
    fun `SuperBoardManager authenticationState is UNAUTHENTICATED when newly constructed`() {
        assertUnauthenticated(
            superboardManager,
            context = "after construction with default settings"
        )
    }

    // ==================== Properties Tests ====================

    @Test
    fun `SuperBoardManager identifier property updates superboardContext when set`() {
        superboardManager.identifier = "user-123"

        assertEqualsWithContext(
            "user-123",
            superboardContext.identifier,
            "superboardContext.identifier",
            "after setting superboardManager.identifier='user-123'"
        )
    }

    @Test
    fun `SuperBoardManager pushToken property updates superboardContext when set`() {
        superboardManager.pushToken = "fcm-token-xyz"

        assertEqualsWithContext(
            "fcm-token-xyz",
            superboardContext.pushToken,
            "superboardContext.pushToken",
            "after setting superboardManager.pushToken='fcm-token-xyz'"
        )
    }

    @Test
    fun `SuperBoardManager attributes property updates superboardContext when set`() {
        val attrs = mapOf("key1" to "value1", "key2" to 42)

        superboardManager.attributes = attrs

        assertEqualsWithContext(
            attrs,
            superboardContext.attributes,
            "superboardContext.attributes",
            "after setting superboardManager.attributes with key1='value1', key2=42"
        )
    }

    // ==================== Lifecycle Tests ====================

    @Test
    fun `SuperBoardManager onAppForegrounded delegates to eventsManager`() = runTest {
        superboardManager.onAppForegrounded()

        coVerify { mockEventsManager.onAppForegrounded() }
    }

    @Test
    fun `SuperBoardManager onAppBackgrounded delegates to eventsManager`() {
        superboardManager.onAppBackgrounded()

        verify { mockEventsManager.onAppBackgrounded() }
    }

    // ==================== Generate Link Tests ====================

    @Test
    fun `SuperBoardManager generateLink returns LSResult Error when SDK is disabled`() = runTest {
        superboardContext.settings.sdkEnabled = false

        val result = superboardManager.generateLink(
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
    fun `SuperBoardManager generateLink returns LSResult Error with not ready message when unauthenticated`() = runTest {
        assertUnauthenticated(superboardManager, context = "before generateLink() call")

        val result = superboardManager.generateLink(
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
    fun `SuperBoardManager generateLink calls service and returns Success when authenticated`() = runTest {
        superboardManager.authenticationState = SuperBoardManager.AuthenticationState.AUTHENTICATED

        val expectedResponse = GenerateLinkResponse(
            link = "https://test.superboard.io/abc123"
        )

        coEvery {
            mockSuperBoardService.generateLink(
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

        val result = superboardManager.generateLink(
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
            "https://test.superboard.io/abc123",
            response.link,
            "link",
            "after generateLink() returns success"
        )

        coVerify {
            mockSuperBoardService.generateLink(
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
    fun `SuperBoardManager linkDetails returns LSResult Error when SDK is disabled`() = runTest {
        superboardContext.settings.sdkEnabled = false

        val result = superboardManager.linkDetails("/test-path")

        assertResultError(
            result,
            context = "after linkDetails() with sdkEnabled=false"
        )
    }

    @Test
    fun `SuperBoardManager linkDetails calls service and returns Success when authenticated`() = runTest {
        superboardManager.authenticationState = SuperBoardManager.AuthenticationState.AUTHENTICATED

        val expectedResponse = LinkDetailsResponse(
            link = mapOf("url" to "https://test.superboard.io/path", "title" to "Test Title")
        )

        coEvery { mockSuperBoardService.linkDetails(any()) } returns LSResult.Success(expectedResponse)

        val result = superboardManager.linkDetails("/path")

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

        coVerify { mockSuperBoardService.linkDetails("/path") }
    }

    // ==================== Handle Intent Tests ====================

    @Test
    fun `SuperBoardManager handleIntent returns null when not authenticated`() = runTest {
        val intent = Intent()

        val result = superboardManager.handleIntent(intent, delayEvents = false)

        assertNullWithContext(
            result,
            "handleIntent result",
            "after handleIntent() with UNAUTHENTICATED state"
        )
    }

    @Test
    fun `SuperBoardManager handleIntent with data URI calls payloadWithLinkFor and returns DeeplinkDetails`() = runTest {
        superboardManager.authenticationState = SuperBoardManager.AuthenticationState.AUTHENTICATED

        val intent = Intent().apply {
            data = Uri.parse("https://test.superboard.io/deep/link")
        }

        val expectedDetails = DeeplinkDetails(
            link = "https://test.superboard.io/deep/link",
            data = mapOf("key" to "value" as Object),
            tracking = null
        )

        coEvery { mockSuperBoardService.payloadWithLinkFor(any()) } returns LSResult.Success(expectedDetails)
        coEvery { mockEventsManager.setLinkToNewFutureActions(any(), any()) } just Runs

        val result = superboardManager.handleIntent(intent, delayEvents = false)

        assertNotNullWithContext(
            result,
            "handleIntent result",
            "after handleIntent() with data URI and AUTHENTICATED state"
        )
        assertEqualsWithContext(
            "https://test.superboard.io/deep/link",
            result?.link,
            "link",
            "after handleIntent() with data URI"
        )

        coVerify { mockEventsManager.setLinkToNewFutureActions(any(), delayEvents = false) }
        coVerify { mockSuperBoardService.payloadWithLinkFor(any()) }
    }

    @Test
    fun `SuperBoardManager handleIntent returns DeeplinkDetails with data and tracking when present`() = runTest {
        superboardManager.authenticationState = SuperBoardManager.AuthenticationState.AUTHENTICATED

        val intent = Intent().apply {
            data = Uri.parse("https://test.superboard.io/promo")
        }

        val expectedDetails = DeeplinkDetails(
            link = "https://test.superboard.io/promo",
            data = mapOf("promo" to "summer2024" as Object),
            tracking = mapOf("campaign" to "email" as Object)
        )

        coEvery { mockSuperBoardService.payloadWithLinkFor(any()) } returns LSResult.Success(expectedDetails)
        coEvery { mockEventsManager.setLinkToNewFutureActions(any(), any()) } just Runs

        val result = superboardManager.handleIntent(intent, delayEvents = false)

        assertNotNullWithContext(
            result,
            "handleIntent result",
            "after handleIntent() with promo link"
        )
        assertEqualsWithContext(
            "https://test.superboard.io/promo",
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
    fun `SuperBoardManager handleIntent returns null when service returns error`() = runTest {
        superboardManager.authenticationState = SuperBoardManager.AuthenticationState.AUTHENTICATED

        val intent = Intent().apply {
            data = Uri.parse("https://test.superboard.io/error")
        }

        coEvery { mockSuperBoardService.payloadWithLinkFor(any()) } returns LSResult.Error(Exception("Network error"))
        coEvery { mockEventsManager.setLinkToNewFutureActions(any(), any()) } just Runs

        val result = superboardManager.handleIntent(intent, delayEvents = false)

        assertNullWithContext(
            result,
            "handleIntent result",
            "after handleIntent() when service returns error"
        )
    }

    @Test
    fun `SuperBoardManager handleIntent updates eventsManager linkForFutureActions on success`() = runTest {
        superboardManager.authenticationState = SuperBoardManager.AuthenticationState.AUTHENTICATED

        val intent = Intent().apply {
            data = Uri.parse("https://test.superboard.io/track")
        }

        val expectedDetails = DeeplinkDetails(
            link = "https://test.superboard.io/resolved-link",
            data = mapOf("key" to "value" as Object),
            tracking = null
        )

        coEvery { mockSuperBoardService.payloadWithLinkFor(any()) } returns LSResult.Success(expectedDetails)
        coEvery { mockEventsManager.setLinkToNewFutureActions(any(), any()) } just Runs

        superboardManager.handleIntent(intent, delayEvents = false)

        coVerify { mockEventsManager.setLinkToNewFutureActions("https://test.superboard.io/resolved-link", delayEvents = false) }
    }

    // ==================== Payment Events Tests ====================

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `SuperBoardManager logInAppPurchase delegates to eventsManager`() = runTest {
    // PURCHASE_EVENT_DISABLED:     val originalJson = """{"orderId": "test123", "productId": "premium"}"""
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     coEvery { mockEventsManager.logInAppPurchase(any()) } just Runs
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     superboardManager.logInAppPurchase(originalJson)
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     coVerify { mockEventsManager.logInAppPurchase(originalJson) }
    // PURCHASE_EVENT_DISABLED: }

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `SuperBoardManager logCustomPurchase delegates to eventsManager with correct parameters`() = runTest {
    // PURCHASE_EVENT_DISABLED:     coEvery {
    // PURCHASE_EVENT_DISABLED:         mockEventsManager.logCustomPurchase(any(), any(), any(), any(), any())
    // PURCHASE_EVENT_DISABLED:     } just Runs
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     superboardManager.logCustomPurchase(
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
    fun `SuperBoardManager identifier property can be set to null after being set`() {
        superboardContext.identifier = "existing-user"
        assertEqualsWithContext(
            "existing-user",
            superboardManager.identifier,
            "identifier",
            "after setting superboardContext.identifier"
        )

        superboardManager.identifier = null

        assertNullWithContext(
            superboardManager.identifier,
            "identifier",
            "after setting superboardManager.identifier=null"
        )
        assertNullWithContext(
            superboardContext.identifier,
            "superboardContext.identifier",
            "after setting superboardManager.identifier=null"
        )
    }

    @Test
    fun `SuperBoardManager handleIntent returns null when DeeplinkDetails has null link and null data`() = runTest {
        superboardManager.authenticationState = SuperBoardManager.AuthenticationState.AUTHENTICATED

        val intent = Intent()

        val emptyDetails = DeeplinkDetails(
            link = null,
            data = null,
            tracking = null
        )

        coEvery { mockSuperBoardService.payloadFor(any()) } returns LSResult.Success(emptyDetails)
        coEvery { mockEventsManager.setLinkToNewFutureActions(any(), any()) } just Runs

        val result = superboardManager.handleIntent(intent, delayEvents = false)

        assertNullWithContext(
            result,
            "handleIntent result",
            "after handleIntent() when DeeplinkDetails has null link and data"
        )
    }
}

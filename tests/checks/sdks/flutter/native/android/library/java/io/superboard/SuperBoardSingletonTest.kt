package io.superboard

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import io.superboard.TestAssertions.assertEqualsWithContext
import io.superboard.TestAssertions.assertNotNullWithContext
import io.superboard.TestAssertions.assertNullWithContext
import io.superboard.TestAssertions.assertTrueWithContext
import io.superboard.TestAssertions.assertFalseWithContext
import io.superboard.TestAssertions.assertCallbackInvokedWithLink
import io.superboard.TestAssertions.assertCallbackInvoked
import io.superboard.e2e.E2ETestUtils
import io.superboard.handlers.SuperBoardContext
import io.superboard.handlers.SuperBoardManager
import io.superboard.model.DebugLogger
import io.superboard.model.DeeplinkDetails
import io.superboard.model.GenerateLinkResponse
import io.superboard.model.LogLevel
// PURCHASE_EVENT_DISABLED: import io.superboard.model.events.PaymentEventType
import io.superboard.model.exceptions.SuperBoardErrorCode
import io.superboard.model.exceptions.SuperBoardException
import io.superboard.utils.LSResult
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

/**
 * Core unit tests for SuperBoard singleton class.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class SuperBoardSingletonTest {

    private lateinit var application: Application
    private lateinit var context: Context
    private val testDispatcher = StandardTestDispatcher()
    private val baseURL = "https://sdk.example.com"

    @Before
    fun setUp() {
        MockKAnnotations.init(this, relaxed = true)
        Dispatchers.setMain(testDispatcher)

        application = RuntimeEnvironment.getApplication()
        context = application.applicationContext

        E2ETestUtils.resetSuperBoardSingleton()

        DebugLogger.instance.logLevel = LogLevel.INFO
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        clearAllMocks()
        E2ETestUtils.resetSuperBoardSingleton()
    }

    // ==================== Configuration Tests ====================

    @Test
    fun `SuperBoard configure initializes superboardManager when given valid API key`() {
        val apiKey = "test-api-key-123"

        SuperBoard.configure(application, apiKey, useTestEnvironment = false, baseURL = baseURL)

        val superboardInstance = getSuperBoardInstance()
        val superboardManagerField = SuperBoard::class.java.getDeclaredField("superboardManager")
        superboardManagerField.isAccessible = true
        assertNotNullWithContext(
            superboardManagerField.get(superboardInstance),
            "superboardManager",
            "after configure() with apiKey='$apiKey'"
        )
    }

    @Test
    fun `SuperBoard configure sets useTestEnvironment flag in superboardContext settings`() {
        val apiKey = "test-api-key"

        SuperBoard.configure(application, apiKey, useTestEnvironment = true, baseURL = baseURL)

        val superboardInstance = getSuperBoardInstance()
        val superboardContextField = SuperBoard::class.java.getDeclaredField("superboardContext")
        superboardContextField.isAccessible = true
        val superboardContext = superboardContextField.get(superboardInstance) as SuperBoardContext
        assertTrueWithContext(
            superboardContext.settings.useTestEnvironment,
            "useTestEnvironment",
            "after configure() with useTestEnvironment=true"
        )
    }

    @Test
    fun `SuperBoard configure can be called multiple times with different settings`() {
        SuperBoard.configure(application, "first-key", useTestEnvironment = false, baseURL = baseURL)
        SuperBoard.configure(application, "second-key", useTestEnvironment = true, baseURL = baseURL)

        val superboardInstance = getSuperBoardInstance()
        val superboardContextField = SuperBoard::class.java.getDeclaredField("superboardContext")
        superboardContextField.isAccessible = true
        val superboardContext = superboardContextField.get(superboardInstance) as SuperBoardContext
        assertTrueWithContext(
            superboardContext.settings.useTestEnvironment,
            "useTestEnvironment",
            "after second configure() call with useTestEnvironment=true"
        )
    }

    // ==================== SDK Enable/Disable Tests ====================

    @Test
    fun `SuperBoard setSDK enables SDK when enabled parameter is true`() {
        SuperBoard.configure(application, "test-api-key", useTestEnvironment = false, baseURL = baseURL)

        SuperBoard.setSDK(enabled = true)

        val superboardInstance = getSuperBoardInstance()
        val superboardContextField = SuperBoard::class.java.getDeclaredField("superboardContext")
        superboardContextField.isAccessible = true
        val superboardContext = superboardContextField.get(superboardInstance) as SuperBoardContext
        assertTrueWithContext(
            superboardContext.settings.sdkEnabled,
            "sdkEnabled",
            "after setSDK(enabled=true)"
        )
    }

    @Test
    fun `SuperBoard setSDK disables SDK when enabled parameter is false`() {
        SuperBoard.configure(application, "test-api-key", useTestEnvironment = false, baseURL = baseURL)

        SuperBoard.setSDK(enabled = false)

        val superboardInstance = getSuperBoardInstance()
        val superboardContextField = SuperBoard::class.java.getDeclaredField("superboardContext")
        superboardContextField.isAccessible = true
        val superboardContext = superboardContextField.get(superboardInstance) as SuperBoardContext
        assertFalseWithContext(
            superboardContext.settings.sdkEnabled,
            "sdkEnabled",
            "after setSDK(enabled=false)"
        )
    }

    // ==================== Properties Tests ====================

    @Test
    fun `SuperBoard identifier property can be set after configuration`() {
        SuperBoard.configure(application, "test-api-key", useTestEnvironment = false, baseURL = baseURL)

        SuperBoard.identifier = "user-123"

        assertEqualsWithContext(
            "user-123",
            SuperBoard.identifier,
            "identifier",
            "after setting identifier='user-123'"
        )
    }

    @Test
    fun `SuperBoard pushToken property can be set after configuration`() {
        SuperBoard.configure(application, "test-api-key", useTestEnvironment = false, baseURL = baseURL)

        SuperBoard.pushToken = "fcm-token-abc123"

        assertEqualsWithContext(
            "fcm-token-abc123",
            SuperBoard.pushToken,
            "pushToken",
            "after setting pushToken='fcm-token-abc123'"
        )
    }

    @Test
    fun `SuperBoard attributes property can be set after configuration`() {
        SuperBoard.configure(application, "test-api-key", useTestEnvironment = false, baseURL = baseURL)
        val attrs = mapOf<String, Any>("name" to "John", "age" to 30)

        SuperBoard.attributes = attrs

        assertEqualsWithContext(
            attrs,
            SuperBoard.attributes,
            "attributes",
            "after setting attributes with name='John', age=30"
        )
    }

    // ==================== Lifecycle Tests ====================

    @Test
    fun `SuperBoard lifecycle methods are safe to call before SDK configuration`() {
        // Arrange - SDK is not configured
        val intent = Intent()

        // Act & Assert - these should not throw
        try {
            SuperBoard.onStart(null)
        } catch (e: Exception) {
            fail("onStart should not throw when SDK not configured: ${e.javaClass.simpleName}: ${e.message}")
        }

        try {
            SuperBoard.onNewIntent(intent, null)
        } catch (e: Exception) {
            fail("onNewIntent should not throw when SDK not configured: ${e.javaClass.simpleName}: ${e.message}")
        }

        // Verify SDK state is still valid (not corrupted)
        val superboardInstance = getSuperBoardInstance()
        val superboardManagerField = SuperBoard::class.java.getDeclaredField("superboardManager")
        superboardManagerField.isAccessible = true
        assertNullWithContext(
            superboardManagerField.get(superboardInstance),
            "superboardManager",
            "after calling lifecycle methods before configure - SDK state should remain uncorrupted"
        )
    }

    // ==================== Deeplink Listener Tests ====================

    @Test
    fun `SuperBoard setOnDeeplinkReceivedListener stores listener in singleton`() {
        var receivedDetails: DeeplinkDetails? = null
        val listener = SuperBoardDeeplinkListener { details ->
            receivedDetails = details
        }

        SuperBoard.setOnDeeplinkReceivedListener(null, listener)

        val superboardInstance = getSuperBoardInstance()
        val listenerField = SuperBoard::class.java.getDeclaredField("deeplinkListener")
        listenerField.isAccessible = true
        assertNotNullWithContext(
            listenerField.get(superboardInstance),
            "deeplinkListener",
            "after setOnDeeplinkReceivedListener() with non-null listener"
        )
    }

    // ==================== Link Generation Tests ====================

    @Test
    fun `SuperBoard generateLink returns LINK_GENERATION_ERROR when SDK not configured`() {
        var receivedLink: String? = null
        var receivedException: SuperBoardException? = null

        SuperBoard.generateLink(
            title = "Test",
            listener = { link, error ->
                receivedLink = link
                receivedException = error
            }
        )

        assertNullWithContext(
            receivedLink,
            "link",
            "after generateLink() without SDK configured"
        )
        assertNotNullWithContext(
            receivedException,
            "error",
            "after generateLink() without SDK configured"
        )
        assertEqualsWithContext(
            SuperBoardErrorCode.LINK_GENERATION_ERROR,
            receivedException?.errorCode,
            "errorCode",
            "after generateLink() without SDK configured"
        )
    }

    @Test
    fun `SuperBoard generateLink invokes callback with link URL when authenticated`() {
        val mockManager = mockk<SuperBoardManager>(relaxed = true)
        every { mockManager.authenticationState } returns SuperBoardManager.AuthenticationState.AUTHENTICATED
        coEvery { mockManager.generateLink(any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns
            LSResult.Success(GenerateLinkResponse("https://test.superboard.io/generated-link"))

        injectMockSuperBoardManagerDirectly(mockManager)

        val latch = CountDownLatch(1)
        var callbackInvoked = false
        var receivedLink: String? = null
        var receivedError: Exception? = null

        SuperBoard.generateLink(
            title = "Test Title",
            subtitle = "Test Subtitle",
            imageURL = "https://example.com/image.png",
            data = mapOf("key" to "value"),
            tags = listOf("tag1", "tag2"),
            listener = { link, error ->
                callbackInvoked = true
                receivedLink = link
                receivedError = error
                latch.countDown()
            }
        )

        val startTime = System.currentTimeMillis()
        val timeoutMs = 5_000L
        while (latch.count > 0 && System.currentTimeMillis() - startTime < timeoutMs) {
            testDispatcher.scheduler.advanceUntilIdle()
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(10)
        }

        assertCallbackInvoked(
            callbackInvoked,
            timeoutMs,
            "after generateLink() with authenticated mockManager"
        )
        assertCallbackInvokedWithLink(
            link = receivedLink,
            error = receivedError,
            expectedLink = "https://test.superboard.io/generated-link",
            context = "after generateLink() with authenticated mockManager returning success"
        )
    }

    // ==================== Purchase Tests ====================

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `SuperBoard logInAppPurchase does not throw when SDK not configured`() {
    // PURCHASE_EVENT_DISABLED:     val originalJson = """{"productId":"premium","purchaseToken":"abc123"}"""
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     // Should complete without exception
    // PURCHASE_EVENT_DISABLED:     SuperBoard.logInAppPurchase(originalJson)
    // PURCHASE_EVENT_DISABLED: }

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `SuperBoard logCustomPurchase does not throw when SDK not configured`() {
    // PURCHASE_EVENT_DISABLED:     // Should complete without exception
    // PURCHASE_EVENT_DISABLED:     SuperBoard.logCustomPurchase(
    // PURCHASE_EVENT_DISABLED:         type = PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:         priceInCents = 999,
    // PURCHASE_EVENT_DISABLED:         currency = "USD",
    // PURCHASE_EVENT_DISABLED:         productId = "premium"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED: }

    // ==================== Helper Methods ====================

    private fun getSuperBoardInstance(): SuperBoard {
        val instanceField = SuperBoard::class.java.getDeclaredField("instance")
        instanceField.isAccessible = true
        val companionField = SuperBoard::class.java.getDeclaredField("Companion")
        companionField.isAccessible = true
        val companion = companionField.get(null)
        return instanceField.get(companion) as SuperBoard
    }

    private fun injectMockSuperBoardManager(mockManager: SuperBoardManager) {
        try {
            val superboardInstance = getSuperBoardInstance()
            val superboardManagerField = SuperBoard::class.java.getDeclaredField("superboardManager")
            superboardManagerField.isAccessible = true
            superboardManagerField.set(superboardInstance, mockManager)

            // Also cancel and clear the authentication job so generateLink doesn't wait for it
            val authJobField = SuperBoard::class.java.getDeclaredField("authenticationJob")
            authJobField.isAccessible = true
            val currentJob = authJobField.get(superboardInstance) as? kotlinx.coroutines.Job
            currentJob?.cancel()
            authJobField.set(superboardInstance, null)
        } catch (e: Exception) {
            throw RuntimeException("Failed to inject mock SuperBoardManager", e)
        }
    }

    /**
     * Injects a mock SuperBoardManager directly without calling configure().
     * This avoids starting the real authentication job that can cause test issues.
     */
    private fun injectMockSuperBoardManagerDirectly(mockManager: SuperBoardManager) {
        try {
            val superboardInstance = getSuperBoardInstance()

            // Set superboardManager
            val superboardManagerField = SuperBoard::class.java.getDeclaredField("superboardManager")
            superboardManagerField.isAccessible = true
            superboardManagerField.set(superboardInstance, mockManager)

            // Ensure authenticationJob is null (no pending job to wait for)
            val authJobField = SuperBoard::class.java.getDeclaredField("authenticationJob")
            authJobField.isAccessible = true
            authJobField.set(superboardInstance, null)
        } catch (e: Exception) {
            throw RuntimeException("Failed to inject mock SuperBoardManager directly", e)
        }
    }
}

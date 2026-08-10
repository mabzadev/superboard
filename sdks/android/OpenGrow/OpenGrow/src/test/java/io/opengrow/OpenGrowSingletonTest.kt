package io.opengrow

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import io.opengrow.TestAssertions.assertEqualsWithContext
import io.opengrow.TestAssertions.assertNotNullWithContext
import io.opengrow.TestAssertions.assertNullWithContext
import io.opengrow.TestAssertions.assertTrueWithContext
import io.opengrow.TestAssertions.assertFalseWithContext
import io.opengrow.TestAssertions.assertCallbackInvokedWithLink
import io.opengrow.TestAssertions.assertCallbackInvoked
import io.opengrow.e2e.E2ETestUtils
import io.opengrow.handlers.OpenGrowContext
import io.opengrow.handlers.OpenGrowManager
import io.opengrow.model.DebugLogger
import io.opengrow.model.DeeplinkDetails
import io.opengrow.model.GenerateLinkResponse
import io.opengrow.model.LogLevel
// PURCHASE_EVENT_DISABLED: import io.opengrow.model.events.PaymentEventType
import io.opengrow.model.exceptions.OpenGrowErrorCode
import io.opengrow.model.exceptions.OpenGrowException
import io.opengrow.utils.LSResult
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
 * Core unit tests for OpenGrow singleton class.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class OpenGrowSingletonTest {

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

        E2ETestUtils.resetOpenGrowSingleton()

        DebugLogger.instance.logLevel = LogLevel.INFO
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        clearAllMocks()
        E2ETestUtils.resetOpenGrowSingleton()
    }

    // ==================== Configuration Tests ====================

    @Test
    fun `OpenGrow configure initializes opengrowManager when given valid API key`() {
        val apiKey = "test-api-key-123"

        OpenGrow.configure(application, apiKey, useTestEnvironment = false, baseURL = baseURL)

        val opengrowInstance = getOpenGrowInstance()
        val opengrowManagerField = OpenGrow::class.java.getDeclaredField("opengrowManager")
        opengrowManagerField.isAccessible = true
        assertNotNullWithContext(
            opengrowManagerField.get(opengrowInstance),
            "opengrowManager",
            "after configure() with apiKey='$apiKey'"
        )
    }

    @Test
    fun `OpenGrow configure sets useTestEnvironment flag in opengrowContext settings`() {
        val apiKey = "test-api-key"

        OpenGrow.configure(application, apiKey, useTestEnvironment = true, baseURL = baseURL)

        val opengrowInstance = getOpenGrowInstance()
        val opengrowContextField = OpenGrow::class.java.getDeclaredField("opengrowContext")
        opengrowContextField.isAccessible = true
        val opengrowContext = opengrowContextField.get(opengrowInstance) as OpenGrowContext
        assertTrueWithContext(
            opengrowContext.settings.useTestEnvironment,
            "useTestEnvironment",
            "after configure() with useTestEnvironment=true"
        )
    }

    @Test
    fun `OpenGrow configure can be called multiple times with different settings`() {
        OpenGrow.configure(application, "first-key", useTestEnvironment = false, baseURL = baseURL)
        OpenGrow.configure(application, "second-key", useTestEnvironment = true, baseURL = baseURL)

        val opengrowInstance = getOpenGrowInstance()
        val opengrowContextField = OpenGrow::class.java.getDeclaredField("opengrowContext")
        opengrowContextField.isAccessible = true
        val opengrowContext = opengrowContextField.get(opengrowInstance) as OpenGrowContext
        assertTrueWithContext(
            opengrowContext.settings.useTestEnvironment,
            "useTestEnvironment",
            "after second configure() call with useTestEnvironment=true"
        )
    }

    // ==================== SDK Enable/Disable Tests ====================

    @Test
    fun `OpenGrow setSDK enables SDK when enabled parameter is true`() {
        OpenGrow.configure(application, "test-api-key", useTestEnvironment = false, baseURL = baseURL)

        OpenGrow.setSDK(enabled = true)

        val opengrowInstance = getOpenGrowInstance()
        val opengrowContextField = OpenGrow::class.java.getDeclaredField("opengrowContext")
        opengrowContextField.isAccessible = true
        val opengrowContext = opengrowContextField.get(opengrowInstance) as OpenGrowContext
        assertTrueWithContext(
            opengrowContext.settings.sdkEnabled,
            "sdkEnabled",
            "after setSDK(enabled=true)"
        )
    }

    @Test
    fun `OpenGrow setSDK disables SDK when enabled parameter is false`() {
        OpenGrow.configure(application, "test-api-key", useTestEnvironment = false, baseURL = baseURL)

        OpenGrow.setSDK(enabled = false)

        val opengrowInstance = getOpenGrowInstance()
        val opengrowContextField = OpenGrow::class.java.getDeclaredField("opengrowContext")
        opengrowContextField.isAccessible = true
        val opengrowContext = opengrowContextField.get(opengrowInstance) as OpenGrowContext
        assertFalseWithContext(
            opengrowContext.settings.sdkEnabled,
            "sdkEnabled",
            "after setSDK(enabled=false)"
        )
    }

    // ==================== Properties Tests ====================

    @Test
    fun `OpenGrow identifier property can be set after configuration`() {
        OpenGrow.configure(application, "test-api-key", useTestEnvironment = false, baseURL = baseURL)

        OpenGrow.identifier = "user-123"

        assertEqualsWithContext(
            "user-123",
            OpenGrow.identifier,
            "identifier",
            "after setting identifier='user-123'"
        )
    }

    @Test
    fun `OpenGrow pushToken property can be set after configuration`() {
        OpenGrow.configure(application, "test-api-key", useTestEnvironment = false, baseURL = baseURL)

        OpenGrow.pushToken = "fcm-token-abc123"

        assertEqualsWithContext(
            "fcm-token-abc123",
            OpenGrow.pushToken,
            "pushToken",
            "after setting pushToken='fcm-token-abc123'"
        )
    }

    @Test
    fun `OpenGrow attributes property can be set after configuration`() {
        OpenGrow.configure(application, "test-api-key", useTestEnvironment = false, baseURL = baseURL)
        val attrs = mapOf<String, Any>("name" to "John", "age" to 30)

        OpenGrow.attributes = attrs

        assertEqualsWithContext(
            attrs,
            OpenGrow.attributes,
            "attributes",
            "after setting attributes with name='John', age=30"
        )
    }

    // ==================== Lifecycle Tests ====================

    @Test
    fun `OpenGrow lifecycle methods are safe to call before SDK configuration`() {
        // Arrange - SDK is not configured
        val intent = Intent()

        // Act & Assert - these should not throw
        try {
            OpenGrow.onStart(null)
        } catch (e: Exception) {
            fail("onStart should not throw when SDK not configured: ${e.javaClass.simpleName}: ${e.message}")
        }

        try {
            OpenGrow.onNewIntent(intent, null)
        } catch (e: Exception) {
            fail("onNewIntent should not throw when SDK not configured: ${e.javaClass.simpleName}: ${e.message}")
        }

        // Verify SDK state is still valid (not corrupted)
        val opengrowInstance = getOpenGrowInstance()
        val opengrowManagerField = OpenGrow::class.java.getDeclaredField("opengrowManager")
        opengrowManagerField.isAccessible = true
        assertNullWithContext(
            opengrowManagerField.get(opengrowInstance),
            "opengrowManager",
            "after calling lifecycle methods before configure - SDK state should remain uncorrupted"
        )
    }

    // ==================== Deeplink Listener Tests ====================

    @Test
    fun `OpenGrow setOnDeeplinkReceivedListener stores listener in singleton`() {
        var receivedDetails: DeeplinkDetails? = null
        val listener = OpenGrowDeeplinkListener { details ->
            receivedDetails = details
        }

        OpenGrow.setOnDeeplinkReceivedListener(null, listener)

        val opengrowInstance = getOpenGrowInstance()
        val listenerField = OpenGrow::class.java.getDeclaredField("deeplinkListener")
        listenerField.isAccessible = true
        assertNotNullWithContext(
            listenerField.get(opengrowInstance),
            "deeplinkListener",
            "after setOnDeeplinkReceivedListener() with non-null listener"
        )
    }

    // ==================== Link Generation Tests ====================

    @Test
    fun `OpenGrow generateLink returns LINK_GENERATION_ERROR when SDK not configured`() {
        var receivedLink: String? = null
        var receivedException: OpenGrowException? = null

        OpenGrow.generateLink(
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
            OpenGrowErrorCode.LINK_GENERATION_ERROR,
            receivedException?.errorCode,
            "errorCode",
            "after generateLink() without SDK configured"
        )
    }

    @Test
    fun `OpenGrow generateLink invokes callback with link URL when authenticated`() {
        val mockManager = mockk<OpenGrowManager>(relaxed = true)
        every { mockManager.authenticationState } returns OpenGrowManager.AuthenticationState.AUTHENTICATED
        coEvery { mockManager.generateLink(any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns
            LSResult.Success(GenerateLinkResponse("https://test.opengrow.io/generated-link"))

        injectMockOpenGrowManagerDirectly(mockManager)

        val latch = CountDownLatch(1)
        var callbackInvoked = false
        var receivedLink: String? = null
        var receivedError: Exception? = null

        OpenGrow.generateLink(
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
            expectedLink = "https://test.opengrow.io/generated-link",
            context = "after generateLink() with authenticated mockManager returning success"
        )
    }

    // ==================== Purchase Tests ====================

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `OpenGrow logInAppPurchase does not throw when SDK not configured`() {
    // PURCHASE_EVENT_DISABLED:     val originalJson = """{"productId":"premium","purchaseToken":"abc123"}"""
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     // Should complete without exception
    // PURCHASE_EVENT_DISABLED:     OpenGrow.logInAppPurchase(originalJson)
    // PURCHASE_EVENT_DISABLED: }

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `OpenGrow logCustomPurchase does not throw when SDK not configured`() {
    // PURCHASE_EVENT_DISABLED:     // Should complete without exception
    // PURCHASE_EVENT_DISABLED:     OpenGrow.logCustomPurchase(
    // PURCHASE_EVENT_DISABLED:         type = PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:         priceInCents = 999,
    // PURCHASE_EVENT_DISABLED:         currency = "USD",
    // PURCHASE_EVENT_DISABLED:         productId = "premium"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED: }

    // ==================== Helper Methods ====================

    private fun getOpenGrowInstance(): OpenGrow {
        val instanceField = OpenGrow::class.java.getDeclaredField("instance")
        instanceField.isAccessible = true
        val companionField = OpenGrow::class.java.getDeclaredField("Companion")
        companionField.isAccessible = true
        val companion = companionField.get(null)
        return instanceField.get(companion) as OpenGrow
    }

    private fun injectMockOpenGrowManager(mockManager: OpenGrowManager) {
        try {
            val opengrowInstance = getOpenGrowInstance()
            val opengrowManagerField = OpenGrow::class.java.getDeclaredField("opengrowManager")
            opengrowManagerField.isAccessible = true
            opengrowManagerField.set(opengrowInstance, mockManager)

            // Also cancel and clear the authentication job so generateLink doesn't wait for it
            val authJobField = OpenGrow::class.java.getDeclaredField("authenticationJob")
            authJobField.isAccessible = true
            val currentJob = authJobField.get(opengrowInstance) as? kotlinx.coroutines.Job
            currentJob?.cancel()
            authJobField.set(opengrowInstance, null)
        } catch (e: Exception) {
            throw RuntimeException("Failed to inject mock OpenGrowManager", e)
        }
    }

    /**
     * Injects a mock OpenGrowManager directly without calling configure().
     * This avoids starting the real authentication job that can cause test issues.
     */
    private fun injectMockOpenGrowManagerDirectly(mockManager: OpenGrowManager) {
        try {
            val opengrowInstance = getOpenGrowInstance()

            // Set opengrowManager
            val opengrowManagerField = OpenGrow::class.java.getDeclaredField("opengrowManager")
            opengrowManagerField.isAccessible = true
            opengrowManagerField.set(opengrowInstance, mockManager)

            // Ensure authenticationJob is null (no pending job to wait for)
            val authJobField = OpenGrow::class.java.getDeclaredField("authenticationJob")
            authJobField.isAccessible = true
            authJobField.set(opengrowInstance, null)
        } catch (e: Exception) {
            throw RuntimeException("Failed to inject mock OpenGrowManager directly", e)
        }
    }
}

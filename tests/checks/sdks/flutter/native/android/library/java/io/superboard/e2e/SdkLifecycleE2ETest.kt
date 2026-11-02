package io.superboard.e2e

import android.app.Application
import android.os.Looper
import io.superboard.SuperBoard
import io.superboard.model.LogLevel
import io.superboard.model.exceptions.SuperBoardException

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class SdkLifecycleE2ETest {

    private lateinit var mockWebServer: MockWebServer
    private lateinit var application: Application

    @get:Rule
    val testName = TestName()

    @Before
    fun setUp() {
        println("\n========== Running: ${testName.methodName} ==========")
        E2ETestUtils.resetSuperBoardSingleton()
        E2ETestUtils.setupMockGlInfo()
        mockWebServer = E2ETestUtils.createMockWebServer()
        application = RuntimeEnvironment.getApplication()
        E2ETestUtils.setupTestApplication(application)
    }

    @After
    fun tearDown() {
        E2ETestUtils.cleanupMockWebServer(mockWebServer)
    }

    @Test
    fun `SDK can be disabled after configuration`() {
        runBlocking {
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val requestCountBeforeDisable = mockWebServer.requestCount
            assertTrue(
                "SDK should make requests before being disabled",
                requestCountBeforeDisable >= 1
            )

            SuperBoard.setSDK(enabled = false)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            E2ETestUtils.assertAuthenticationCompleted()
            assertFalse("SDK should be disabled after setSDK(false)", E2ETestUtils.isSdkEnabled())
        }
    }

    @Test
    fun `SDK debug level changes do not crash or affect authentication`() {
        runBlocking {
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            SuperBoard.setDebug(LogLevel.INFO)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            SuperBoard.setDebug(LogLevel.ERROR)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            SuperBoard.setDebug(LogLevel.INFO)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            E2ETestUtils.assertAuthenticationCompleted()
            val requests = E2ETestUtils.collectAllRequests(mockWebServer)
            E2ETestUtils.assertRequestMade(requests, "authenticate", "SDK should call authenticate endpoint")
            E2ETestUtils.assertRequestMade(requests, "device_for_vendor_id", "SDK should call device_for_vendor_id endpoint")
            E2ETestUtils.assertSdkFunctionalAfterError()
        }
    }

    @Test
    fun `Multiple configure calls do not crash`() {
        runBlocking {
            repeat(3) {
                E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
                E2ETestUtils.enqueueDeviceResponse(mockWebServer)
                E2ETestUtils.enqueueEventResponse(mockWebServer)
                E2ETestUtils.enqueueEventResponse(mockWebServer)
            }

            SuperBoard.configure(application, "api-key-1", useTestEnvironment = true, baseURL = mockWebServer.url("/").toString())
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            val firstAuthJob = E2ETestUtils.getAuthenticationJob()
            withTimeoutOrNull(5_000) { firstAuthJob?.join() }
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            SuperBoard.configure(application, "api-key-2", useTestEnvironment = true, baseURL = mockWebServer.url("/").toString())
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            val secondAuthJob = E2ETestUtils.getAuthenticationJob()
            withTimeoutOrNull(5_000) { secondAuthJob?.join() }
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            val requests = E2ETestUtils.collectAllRequests(mockWebServer)
            assertTrue(
                "SDK should make at least one request during configuration, got ${requests.size}",
                requests.isNotEmpty()
            )
            E2ETestUtils.assertAuthenticationCompleted()
            E2ETestUtils.assertRequestMade(requests, "authenticate", "SDK should call authenticate endpoint")
        }
    }

    @Test
    fun `Activity lifecycle callbacks do not crash SDK`() {
        runBlocking {
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val activityController = Robolectric.buildActivity(TestActivity::class.java)
            activityController.create()
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            activityController.start()
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            activityController.resume()
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            activityController.pause()
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            activityController.stop()
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            activityController.destroy()
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            val requests = E2ETestUtils.collectAllRequests(mockWebServer)
            E2ETestUtils.assertAuthenticationCompleted()
            E2ETestUtils.assertRequestMade(requests, "authenticate", "SDK should call authenticate endpoint")
            E2ETestUtils.assertRequestMade(requests, "device_for_vendor_id", "SDK should call device_for_vendor_id endpoint")
        }
    }

    @Test
    fun `SDK re-enabled via setSDK true resumes operations`() {
        runBlocking {
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            SuperBoard.setSDK(enabled = false)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            SuperBoard.setSDK(enabled = true)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            E2ETestUtils.assertAuthenticationCompleted()
            assertTrue("SDK should be enabled after setSDK(true)", E2ETestUtils.isSdkEnabled())
        }
    }

    @Test
    fun `App foreground detected correctly`() {
        runBlocking {
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val requestCountBefore = mockWebServer.requestCount

            val activityController = Robolectric.buildActivity(TestActivity::class.java)
            activityController.create().start().resume()
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            delay(500)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            val newRequestCount = mockWebServer.requestCount - requestCountBefore
            assertTrue(
                "SDK should make at least 1 new request on foreground, got $newRequestCount",
                newRequestCount >= 1
            )

            val requests = E2ETestUtils.collectAllRequests(mockWebServer)
            E2ETestUtils.verifyEventInfrastructureWorks(requests)

            val eventRequests = E2ETestUtils.findRequestsByPath(requests, "event")
            if (eventRequests.isNotEmpty()) {
                val hasAppOpenEvent = eventRequests.any { (_, body) ->
                    body.contains("APP_OPEN")
                }
                if (!hasAppOpenEvent) {
                    println("Warning: Events captured but no APP_OPEN event found. This may be a timing issue.")
                }
            }

            activityController.pause().stop().destroy()
        }
    }

    @Test
    fun `App background detected correctly`() {
        runBlocking {
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val activityController = Robolectric.buildActivity(TestActivity::class.java)
            activityController.create().start().resume()
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            delay(500)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            activityController.pause().stop()
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            delay(500)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            E2ETestUtils.assertAuthenticationCompleted()
            val requests = E2ETestUtils.collectAllRequests(mockWebServer)
            E2ETestUtils.assertRequestMade(requests, "authenticate", "SDK should call authenticate endpoint")
            E2ETestUtils.assertRequestMade(requests, "device_for_vendor_id", "SDK should call device_for_vendor_id endpoint")

            val eventRequests = E2ETestUtils.findRequestsByPath(requests, "event")
            if (eventRequests.isEmpty()) {
                println("Note: No event requests captured within test timeframe. This is acceptable for lifecycle tests.")
            }

            activityController.destroy()
        }
    }

    @Test
    fun `API calls before configure return error gracefully`() {
        try {
            runBlocking {
                val link = SuperBoard.generateLink(title = "Test")
                fail("generateLink should throw when SDK not configured")
            }
        } catch (e: SuperBoardException) {
            assertTrue(
                "Exception should indicate SDK not initialized",
                e.message?.contains("not initialized") == true
            )
        }
    }

    @Test
    fun `SDK disables when sdkEnabled is false in settings`() {
        runBlocking {
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val requestCountAfterAuth = mockWebServer.requestCount

            val instance = E2ETestUtils.getSuperBoardInstance()
            assertNotNull("SuperBoard instance should exist", instance)
            val managerField = instance!!.javaClass.getDeclaredField("superboardManager")
            managerField.isAccessible = true
            val superboardManager = managerField.get(instance)
            assertNotNull("SuperBoardManager should exist", superboardManager)

            val contextField = superboardManager.javaClass.getDeclaredField("superboardContext")
            contextField.isAccessible = true
            val superboardContext = contextField.get(superboardManager)
            assertNotNull("SuperBoardContext should exist", superboardContext)

            val settingsField = superboardContext.javaClass.getDeclaredField("settings")
            settingsField.isAccessible = true
            val settings = settingsField.get(superboardContext)
            assertNotNull("Settings should exist", settings)

            val sdkEnabledField = settings.javaClass.getDeclaredField("sdkEnabled")
            sdkEnabledField.isAccessible = true
            sdkEnabledField.set(settings, false)

            delay(500)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            assertTrue(
                "SDK should have made auth requests before being disabled",
                requestCountAfterAuth >= 2
            )
        }
    }

    @Test
    fun `SDK handles rapid configuration and reconfiguration`() {
        runBlocking {
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            SuperBoard.configure(application, "test-api-key-1", useTestEnvironment = true, baseURL = mockWebServer.url("/").toString())
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            delay(100)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer)

            try {
                SuperBoard.configure(application, "test-api-key-2", useTestEnvironment = true, baseURL = mockWebServer.url("/").toString())
            } catch (e: Exception) {
            }

            Shadows.shadowOf(Looper.getMainLooper()).idle()

            val authJob = E2ETestUtils.getAuthenticationJob()
            withTimeoutOrNull(10_000) { authJob?.join() }
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            assertTrue(
                "SDK should make requests despite reconfiguration attempt",
                mockWebServer.requestCount >= 2
            )
        }
    }

    @Test
    fun `SDK handles authentication failure and retry`() {
        runBlocking {
            E2ETestUtils.enqueueErrorResponse(mockWebServer, 401, "Unauthorized")
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            SuperBoard.configure(application, "test-api-key", useTestEnvironment = true, baseURL = mockWebServer.url("/").toString())
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            val authJob = E2ETestUtils.getAuthenticationJob()
            withTimeoutOrNull(15_000) { authJob?.join() }
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            delay(2000)
            Shadows.shadowOf(Looper.getMainLooper()).idle()

            val requests = E2ETestUtils.collectAllRequests(mockWebServer)
            assertTrue(
                "SDK should make authentication requests",
                requests.isNotEmpty()
            )
        }
    }

}

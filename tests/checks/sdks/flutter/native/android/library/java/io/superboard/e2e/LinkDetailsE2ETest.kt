package io.superboard.e2e

import android.app.Application
import android.os.Looper
import io.superboard.SuperBoard
import io.superboard.model.exceptions.SuperBoardException
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class LinkDetailsE2ETest {

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
    fun `Link details before authentication throws exception`() {
        runBlocking {
            try {
                SuperBoard.linkDetails(path = "test-path")
                fail("linkDetails should throw when not authenticated")
            } catch (e: SuperBoardException) {
                assertTrue("Should throw SDK_NOT_INITIALIZED error",
                    e.message?.contains("not initialized") == true)
            }
        }
    }

    @Test
    fun `Link details returns valid details for existing link`() {
        E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
        E2ETestUtils.enqueueDeviceResponse(mockWebServer)
        E2ETestUtils.enqueueLinkDetailsResponse(mockWebServer, title = "Test Link", subtitle = "Description")

        SuperBoard.configure(application, "test-api-key", useTestEnvironment = true, baseURL = mockWebServer.url("/").toString())
        Shadows.shadowOf(Looper.getMainLooper()).idle()

        val authJob = E2ETestUtils.getAuthenticationJob()
        E2ETestUtils.runWithLooperPumping(10_000) { authJob?.join() }

        val result = E2ETestUtils.runWithLooperPumping(10_000) {
            SuperBoard.linkDetails(path = "test-link-path")
        }

        assertNotNull("linkDetails should return result", result)
        assertEquals("Should return mocked title", "Test Link", result?.get("title"))
        assertEquals("Should return mocked subtitle", "Description", result?.get("subtitle"))
    }

    @Test
    fun `Link details with custom data returns data map`() {
        E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
        E2ETestUtils.enqueueDeviceResponse(mockWebServer)
        E2ETestUtils.enqueueLinkDetailsResponse(mockWebServer, title = "Product Page", subtitle = "Check out this item")

        SuperBoard.configure(application, "test-api-key", useTestEnvironment = true, baseURL = mockWebServer.url("/").toString())
        Shadows.shadowOf(Looper.getMainLooper()).idle()

        val authJob = E2ETestUtils.getAuthenticationJob()
        E2ETestUtils.runWithLooperPumping(10_000) { authJob?.join() }

        val result = E2ETestUtils.runWithLooperPumping(10_000) {
            SuperBoard.linkDetails(path = "product-page")
        }

        assertNotNull("linkDetails should return result with custom data", result)
        assertEquals("Should return mocked title", "Product Page", result?.get("title"))
        assertEquals("Should return mocked subtitle", "Check out this item", result?.get("subtitle"))
    }

    @Test
    fun `Link details for non-existent link returns null or error`() {
        E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
        E2ETestUtils.enqueueDeviceResponse(mockWebServer)
        E2ETestUtils.enqueueErrorResponse(mockWebServer, 404, "Link not found")

        SuperBoard.configure(application, "test-api-key", useTestEnvironment = true, baseURL = mockWebServer.url("/").toString())
        Shadows.shadowOf(Looper.getMainLooper()).idle()

        val authJob = E2ETestUtils.getAuthenticationJob()
        E2ETestUtils.runWithLooperPumping(10_000) { authJob?.join() }

        val result = E2ETestUtils.runWithLooperPumping(10_000) {
            SuperBoard.linkDetails(path = "non-existent-path")
        }

        assertNull("linkDetails for non-existent path should return null", result)
    }

    @Test
    fun `Link details handles server error gracefully`() {
        E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
        E2ETestUtils.enqueueDeviceResponse(mockWebServer)
        E2ETestUtils.enqueueErrorResponse(mockWebServer, 500, "Internal Server Error")

        SuperBoard.configure(application, "test-api-key", useTestEnvironment = true, baseURL = mockWebServer.url("/").toString())
        Shadows.shadowOf(Looper.getMainLooper()).idle()

        val authJob = E2ETestUtils.getAuthenticationJob()
        E2ETestUtils.runWithLooperPumping(10_000) { authJob?.join() }

        val result = E2ETestUtils.runWithLooperPumping(10_000) {
            SuperBoard.linkDetails(path = "error-test")
        }

        assertNull("linkDetails should return null on server error", result)
        E2ETestUtils.assertAuthenticationCompleted()
        val requests = E2ETestUtils.collectAllRequests(mockWebServer)
        E2ETestUtils.assertRequestMade(requests, "link_details", "SDK should attempt to fetch link details")
        E2ETestUtils.assertSdkFunctionalAfterError()
    }
}

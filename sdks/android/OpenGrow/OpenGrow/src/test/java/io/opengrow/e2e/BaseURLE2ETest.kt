package io.opengrow.e2e

import android.app.Application
import io.opengrow.OpenGrow
import io.opengrow.TestAssertions.assertEqualsWithContext
import io.opengrow.TestAssertions.assertNotNullWithContext
import io.opengrow.TestAssertions.assertTrueWithContext
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
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

/**
 * E2E tests for custom baseURL parameter in OpenGrow.configure().
 * Verifies that the SDK sends requests to the custom base URL when provided.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class BaseURLE2ETest {

    private lateinit var mockWebServer: MockWebServer
    private lateinit var application: Application

    @get:Rule
    val testName = TestName()

    @Before
    fun setUp() {
        println("\n========== Running: ${testName.methodName} ==========")
        E2ETestUtils.resetOpenGrowSingleton()
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
    fun `SDK sends requests to custom baseURL when provided`() {
        runBlocking {
            // Arrange
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer, lastSeen = null)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            val customBaseURL = mockWebServer.url("/").toString()

            // Act
            val activityController = E2ETestUtils.configureAndWaitForAuth(
                application,
                apiKey = "test-api-key",
                baseURL = customBaseURL
            )

            // Assert - SDK should have sent requests to the mock server
            val requestCount = mockWebServer.requestCount
            assertTrueWithContext(
                requestCount > 0,
                "SDK should make requests to custom baseURL",
                "after configure with baseURL=$customBaseURL"
            )

            // Verify the first request path includes /api/v1/sdk/
            val firstRequest = mockWebServer.takeRequest(1, TimeUnit.SECONDS)
            assertNotNullWithContext(
                firstRequest,
                "first request",
                "after SDK configure with custom baseURL"
            )
            assertTrueWithContext(
                firstRequest!!.path!!.startsWith("/api/v1/sdk/"),
                "request path starts with /api/v1/sdk/",
                "request path was: ${firstRequest.path}"
            )

            activityController?.stop()
            activityController?.destroy()
        }
    }

    @Test
    fun `SDK sends requests to custom baseURL with trailing slash stripped`() {
        runBlocking {
            // Arrange
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer, lastSeen = null)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            // Pass URL with trailing slash
            val customBaseURL = mockWebServer.url("/").toString().trimEnd('/') + "/"

            // Act
            val activityController = E2ETestUtils.configureAndWaitForAuth(
                application,
                apiKey = "test-api-key",
                baseURL = customBaseURL
            )

            // Assert - requests should still go to /api/v1/sdk/ (no double slash)
            val firstRequest = mockWebServer.takeRequest(1, TimeUnit.SECONDS)
            assertNotNullWithContext(
                firstRequest,
                "first request",
                "after SDK configure with trailing-slash baseURL"
            )
            assertTrueWithContext(
                firstRequest!!.path!!.startsWith("/api/v1/sdk/"),
                "request path starts with /api/v1/sdk/ (no double slash)",
                "request path was: ${firstRequest.path}"
            )

            activityController?.stop()
            activityController?.destroy()
        }
    }

    @Test
    fun `SDK uses default URL when baseURL is null`() {
        runBlocking {
            // Arrange - enqueue responses but configure WITHOUT baseURL
            // The SDK will try to reach the default server (sdk.opengrow.link),
            // so we configure WITH the mock server URL to verify the null-fallback path
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer, lastSeen = null)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            // Act - configure with baseURL = null (should use BuildConfig.SERVER_URL)
            OpenGrow.configure(application, "test-api-key", useTestEnvironment = true, baseURL = null)

            // Assert - no requests should reach our mock server since the SDK
            // will try to connect to the default production URL
            // Give it a moment to attempt connection
            Thread.sleep(500)
            assertEqualsWithContext(
                0,
                mockWebServer.requestCount,
                "request count to mock server",
                "when baseURL is null, SDK should use default URL, not mock server"
            )
        }
    }

    @Test
    fun `SDK authenticates successfully with custom baseURL`() {
        runBlocking {
            // Arrange
            val testOpenGrowId = "custom-base-url-opengrow-id-456"
            E2ETestUtils.enqueueAuthenticationResponse(mockWebServer, opengrowId = testOpenGrowId)
            E2ETestUtils.enqueueDeviceResponse(mockWebServer, lastSeen = null)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)
            E2ETestUtils.enqueueEventResponse(mockWebServer)

            // Act
            val activityController = E2ETestUtils.configureAndWaitForAuth(
                application,
                apiKey = "test-api-key",
                baseURL = mockWebServer.url("/").toString()
            )

            // Assert - SDK should be authenticated with the correct opengrowId
            E2ETestUtils.assertAuthenticationCompleted()

            val storedOpenGrowId = E2ETestUtils.getOpenGrowId()
            if (storedOpenGrowId != null) {
                assertEqualsWithContext(
                    testOpenGrowId,
                    storedOpenGrowId,
                    "opengrowId",
                    "after authentication with custom baseURL"
                )
            }

            activityController?.stop()
            activityController?.destroy()
        }
    }
}

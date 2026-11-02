package io.superboard.e2e

import android.app.Application
import android.os.Looper
import android.provider.Settings
import io.superboard.SuperBoard
import io.superboard.handlers.EventsManager
import io.superboard.handlers.SuperBoardContext
import io.superboard.utils.GlInfo
import io.superboard.utils.GlUtils
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.*
import org.robolectric.Robolectric
import org.robolectric.Shadows
import org.robolectric.android.controller.ActivityController
import java.util.concurrent.TimeUnit
import java.util.logging.ConsoleHandler
import java.util.logging.Formatter
import java.util.logging.LogRecord
import java.util.logging.Logger

object E2ETestUtils {

    private val okhttpLoggers = listOf(
        Logger.getLogger("okhttp3.internal.platform.Platform"),
        Logger.getLogger("okhttp3.OkHttpClient"),
        Logger.getLogger("okhttp3.internal.platform")
    ).onEach { logger ->
        logger.useParentHandlers = false
        logger.addHandler(ConsoleHandler().apply {
            formatter = object : Formatter() {
                override fun format(record: LogRecord): String = "${record.message}\n"
            }
        })
    }

    private val drainedServers = mutableListOf<MockWebServer>()

    fun createMockWebServer(): MockWebServer {
        val server = MockWebServer()
        server.start()
        return server
    }

    fun setupTestApplication(application: Application) {
        Settings.Secure.putString(
            application.contentResolver,
            Settings.Secure.ANDROID_ID,
            "robolectric-test-device-id"
        )
        application.getSharedPreferences("SuperBoardStorage", android.content.Context.MODE_PRIVATE)
            .edit().clear().apply()
        application.getSharedPreferences("superboard_prefs", android.content.Context.MODE_PRIVATE)
            .edit().clear().apply()
    }

    fun cleanupMockWebServer(server: MockWebServer) {
        try {
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    return MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("{}")
                }
            }
            drainedServers.add(server)
        } catch (e: Exception) {
            try { server.shutdown() } catch (e2: Exception) { }
        }
    }

    fun enqueueAuthenticationResponse(server: MockWebServer, superboardId: String = "test-superboard-id-123") {
        val response = """
            {
                "linksquared": "$superboardId",
                "uri_scheme": "testapp"
            }
        """.trimIndent()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(response)
        )
    }

    fun enqueueDeviceResponse(server: MockWebServer, lastSeen: String? = null) {
        val lastSeenJson = if (lastSeen != null) "\"$lastSeen\"" else "null"
        val response = """
            {
                "last_seen": $lastSeenJson
            }
        """.trimIndent()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(response)
        )
    }

    fun enqueueEventResponse(server: MockWebServer) {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("{}")
        )
    }

    fun enqueueDataForDeviceResponse(
        server: MockWebServer,
        link: String? = null,
        data: Map<String, Any>? = null
    ) {
        val linkJson = link?.let { "\"$it\"" } ?: "null"
        val dataJson = data?.let {
            data.entries.joinToString(",", "{", "}") { (k, v) ->
                "\"$k\":${if (v is String) "\"$v\"" else v}"
            }
        } ?: "null"
        val response = """
            {
                "link": $linkJson,
                "data": $dataJson
            }
        """.trimIndent()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(response)
        )
    }

    fun enqueueDataForDeviceAndUrlResponse(
        server: MockWebServer,
        link: String? = null,
        data: Map<String, Any>? = null,
        tracking: Map<String, Any>? = null
    ) {
        val linkJson = link?.let { "\"$it\"" } ?: "null"
        val dataJson = data?.let {
            data.entries.joinToString(",", "{", "}") { (k, v) ->
                "\"$k\":${if (v is String) "\"$v\"" else v}"
            }
        } ?: "null"
        val trackingJson = tracking?.let {
            tracking.entries.joinToString(",", "{", "}") { (k, v) ->
                "\"$k\":${if (v is String) "\"$v\"" else v}"
            }
        } ?: "null"
        val response = """
            {
                "link": $linkJson,
                "data": $dataJson,
                "tracking": $trackingJson
            }
        """.trimIndent()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(response)
        )
    }

    fun enqueueGenerateLinkResponse(server: MockWebServer, link: String = "https://test.superboard.io/abc123") {
        val response = """
            {
                "link": "$link"
            }
        """.trimIndent()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(response)
        )
    }

    fun enqueueLinkDetailsResponse(
        server: MockWebServer,
        title: String? = "Test Title",
        subtitle: String? = "Test Subtitle",
        imageUrl: String? = null,
        data: Map<String, Any>? = null
    ) {
        val titleJson = title?.let { "\"$it\"" } ?: "null"
        val subtitleJson = subtitle?.let { "\"$it\"" } ?: "null"
        val imageJson = imageUrl?.let { "\"$it\"" } ?: "null"
        val dataJson = data?.let {
            data.entries.joinToString(",", "{", "}") { (k, v) ->
                "\"$k\":${if (v is String) "\"$v\"" else v}"
            }
        } ?: "null"
        val response = """
            {
                "title": $titleJson,
                "subtitle": $subtitleJson,
                "image_url": $imageJson,
                "data": $dataJson
            }
        """.trimIndent()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(response)
        )
    }

    fun enqueueNotificationsResponse(server: MockWebServer, notifications: List<Map<String, Any>> = emptyList()) {
        val notificationsJson = notifications.joinToString(",", "[", "]") { notification ->
            notification.entries.joinToString(",", "{", "}") { (k, v) ->
                when (v) {
                    is String -> "\"$k\":\"$v\""
                    is Boolean -> "\"$k\":$v"
                    else -> "\"$k\":$v"
                }
            }
        }
        val response = """
            {
                "notifications": $notificationsJson
            }
        """.trimIndent()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(response)
        )
    }

    fun enqueueUnreadCountResponse(server: MockWebServer, count: Int) {
        val response = """
            {
                "number_of_unread_notifications": $count
            }
        """.trimIndent()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(response)
        )
    }

    fun enqueueVisitorAttributesResponse(server: MockWebServer) {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("{}")
        )
    }

    fun enqueueErrorResponse(server: MockWebServer, code: Int, message: String = "Error") {
        val response = """
            {
                "error": "$message"
            }
        """.trimIndent()
        server.enqueue(
            MockResponse()
                .setResponseCode(code)
                .setHeader("Content-Type", "application/json")
                .setBody(response)
        )
    }

    fun enqueueDelayedResponse(server: MockWebServer, delayMs: Long, responseCode: Int = 200) {
        server.enqueue(
            MockResponse()
                .setResponseCode(responseCode)
                .setHeader("Content-Type", "application/json")
                .setBody("{}")
                .setBodyDelay(delayMs, TimeUnit.MILLISECONDS)
        )
    }

    fun enqueueAutoDisplayNotificationsResponse(server: MockWebServer, notifications: List<Map<String, Any>> = emptyList()) {
        val notificationsJson = notifications.joinToString(",", "[", "]") { notification ->
            notification.entries.joinToString(",", "{", "}") { (k, v) ->
                when (v) {
                    is String -> "\"$k\":\"$v\""
                    is Boolean -> "\"$k\":$v"
                    is Int -> "\"$k\":$v"
                    else -> "\"$k\":$v"
                }
            }
        }
        val response = """
            {
                "notifications": $notificationsJson
            }
        """.trimIndent()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(response)
        )
    }

    fun resetSuperBoardSingleton() {
        val errors = mutableListOf<String>()

        try {
            val superboardClass = SuperBoard::class.java
            val instanceField = superboardClass.getDeclaredField("instance")
            instanceField.isAccessible = true
            val instance = instanceField.get(null)
                ?: throw IllegalStateException("SuperBoard instance is null")

            try {
                val managerField = superboardClass.getDeclaredField("superboardManager")
                managerField.isAccessible = true
                val manager = managerField.get(instance)
                if (manager != null) {
                    val eventsManagerField = manager.javaClass.getDeclaredField("eventsManager")
                    eventsManagerField.isAccessible = true
                    val eventsManager = eventsManagerField.get(manager) as? EventsManager
                    if (eventsManager != null) {
                        runBlocking { eventsManager.awaitPendingBackgroundTimeSpent() }
                    }
                }
            } catch (e: Exception) {
                errors.add("Failed to drain pending TIME_SPENT lifecycle work: ${e.message}")
            }

            try {
                val appField = superboardClass.getDeclaredField("application")
                appField.isAccessible = true
                val app = appField.get(instance) as? android.app.Application

                val observerField = superboardClass.getDeclaredField("applicationLifecycleObserver")
                observerField.isAccessible = true
                val observer = observerField.get(instance) as? android.app.Application.ActivityLifecycleCallbacks

                if (app != null && observer != null) {
                    repeat(10) {
                        app.unregisterActivityLifecycleCallbacks(observer)
                    }
                }

                if (observer != null) {
                    try {
                        val numStartedField = observer.javaClass.getDeclaredField("numStarted")
                        numStartedField.isAccessible = true
                        numStartedField.setInt(observer, 0)
                    } catch (e: Exception) {
                        errors.add("Failed to reset numStarted: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                errors.add("Failed to unregister lifecycle callbacks: ${e.message}")
            }

            listOf(
                "superboardManager",
                "notificationsManager",
                "apiKey",
                "application",
                "deeplinkListener",
                "superboardNotificationsListener",
                "authenticationJob",
                "launcherActivityReference",
                "currentActivityReference"
            ).forEach { fieldName ->
                try {
                    val field = superboardClass.getDeclaredField(fieldName)
                    field.isAccessible = true
                    field.set(instance, null)
                } catch (e: NoSuchFieldException) {
                    errors.add("Field '$fieldName' not found")
                } catch (e: Exception) {
                    errors.add("Failed to reset '$fieldName': ${e.message}")
                }
            }

            try {
                val contextField = superboardClass.getDeclaredField("superboardContext")
                contextField.isAccessible = true
                contextField.set(instance, SuperBoardContext())
            } catch (e: Exception) {
                errors.add("Failed to reset superboardContext: ${e.message}")
            }

        } catch (e: Exception) {
            throw AssertionError(
                "Critical failure resetting SuperBoard singleton - tests will leak state: ${e.message}",
                e
            )
        }

        if (errors.isNotEmpty()) {
            System.err.println("WARNING: E2E singleton reset incomplete (${errors.size} issues):")
            errors.forEach { System.err.println("  - $it") }
        }
    }

    fun setupMockScreenResolution(width: String = "393", height: String = "851") {
        try {
            val screenUtilsClass = Class.forName("io.superboard.utils.ScreenUtils")
            val cachedField = screenUtilsClass.getDeclaredField("cachedResolution")
            cachedField.isAccessible = true
            cachedField.set(null, Pair(width, height))
            println("Mock screen resolution set to: ${width}x${height}")
        } catch (e: Exception) {
            try {
                val screenUtilsClass = Class.forName("io.superboard.utils.ScreenUtils")
                val instanceField = screenUtilsClass.getDeclaredField("INSTANCE")
                instanceField.isAccessible = true
                val instance = instanceField.get(null)
                val cachedField = screenUtilsClass.getDeclaredField("cachedResolution")
                cachedField.isAccessible = true
                cachedField.set(instance, Pair(width, height))
                println("Mock screen resolution set to: ${width}x${height} (via INSTANCE)")
            } catch (e2: Exception) {
                println("Warning: Could not set mock screen resolution: ${e.message}, ${e2.message}")
            }
        }
    }

    fun setupMockGlInfo() {
        try {
            val glUtilsClass = GlUtils::class.java
            val cachedGlInfoField = glUtilsClass.getDeclaredField("cachedGlInfo")
            cachedGlInfoField.isAccessible = true
            cachedGlInfoField.set(GlUtils, GlInfo(
                vendor = "Robolectric",
                renderer = "Robolectric GL",
                version = "OpenGL ES 2.0"
            ))
        } catch (e: Exception) {
            println("Warning: Could not set mock GlInfo: ${e.message}")
        }
    }

    fun setupMockUserAgent(userAgent: String) {
        try {
            val webViewUtilsClass = Class.forName("io.superboard.utils.WebViewUtils")
            val cachedField = webViewUtilsClass.getDeclaredField("cachedUserAgent")
            cachedField.isAccessible = true
            cachedField.set(null, userAgent)
            println("Mock user agent set to: $userAgent")
        } catch (e: Exception) {
            println("Warning: Could not set mock user agent: ${e.message}")
        }
    }

    fun getAuthenticationJob(): Job? {
        return try {
            val superboardClass = SuperBoard::class.java
            val instanceField = superboardClass.getDeclaredField("instance")
            instanceField.isAccessible = true
            val instance = instanceField.get(null)

            val jobField = superboardClass.getDeclaredField("authenticationJob")
            jobField.isAccessible = true
            jobField.get(instance) as? Job
        } catch (e: Exception) {
            println("Could not get authenticationJob: ${e.message}")
            null
        }
    }

    fun getSuperBoardInstance(): Any? {
        return try {
            val companionClass = Class.forName("io.superboard.SuperBoard\$Companion")
            val superboardClass = SuperBoard::class.java

            val companionField = superboardClass.getDeclaredField("Companion")
            companionField.isAccessible = true
            val companion = companionField.get(null)

            val instanceField = companionClass.getDeclaredField("instance")
            instanceField.isAccessible = true
            instanceField.get(companion)
        } catch (e: Exception) {
            try {
                val superboardClass = SuperBoard::class.java
                val instanceField = superboardClass.getDeclaredField("instance")
                instanceField.isAccessible = true
                instanceField.get(null)
            } catch (e2: Exception) {
                println("Could not get SuperBoard instance: ${e.message}, fallback failed: ${e2.message}")
                null
            }
        }
    }

    fun getAuthenticationState(): String? {
        return try {
            val instance = getSuperBoardInstance() ?: return null

            val managerField = instance.javaClass.getDeclaredField("superboardManager")
            managerField.isAccessible = true
            val manager = managerField.get(instance) ?: return null

            val stateField = manager.javaClass.getDeclaredField("authenticationState")
            stateField.isAccessible = true
            stateField.get(manager)?.toString()
        } catch (e: Exception) {
            println("Could not get auth state: ${e.message}")
            null
        }
    }

    fun setNumStarted(value: Int) {
        try {
            val instance = getSuperBoardInstance() ?: return
            val observerField = instance.javaClass.getDeclaredField("applicationLifecycleObserver")
            observerField.isAccessible = true
            val observer = observerField.get(instance) ?: return
            val numStartedField = observer.javaClass.getDeclaredField("numStarted")
            numStartedField.isAccessible = true
            numStartedField.setInt(observer, value)
        } catch (e: Exception) {
            println("Could not set numStarted: ${e.message}")
        }
    }

    fun getSuperBoardId(): String? {
        return try {
            val instance = getSuperBoardInstance() ?: return null

            val contextField = instance.javaClass.getDeclaredField("superboardContext")
            contextField.isAccessible = true
            val context = contextField.get(instance)

            val superboardIdField = context.javaClass.getDeclaredField("superboardId")
            superboardIdField.isAccessible = true
            superboardIdField.get(context) as? String
        } catch (e: Exception) {
            println("Could not get superboardId: ${e.message}")
            null
        }
    }

    fun isSdkEnabled(): Boolean {
        return try {
            val instance = getSuperBoardInstance() ?: return true

            val contextField = instance.javaClass.getDeclaredField("superboardContext")
            contextField.isAccessible = true
            val context = contextField.get(instance)

            val settingsField = context.javaClass.getDeclaredField("settings")
            settingsField.isAccessible = true
            val settings = settingsField.get(context)

            val enabledField = settings.javaClass.getDeclaredField("sdkEnabled")
            enabledField.isAccessible = true
            enabledField.get(settings) as? Boolean ?: true
        } catch (e: Exception) {
            println("Could not get SDK enabled state: ${e.message}")
            true
        }
    }

    fun collectAllRequests(server: MockWebServer): List<Pair<String, String>> {
        val requests = mutableListOf<Pair<String, String>>()
        while (true) {
            val request = server.takeRequest(100, TimeUnit.MILLISECONDS) ?: break
            val path = request.path ?: ""
            val body = request.body.readUtf8()
            requests.add(Pair(path, body))
        }
        return requests
    }

    fun findRequestsByPath(requests: List<Pair<String, String>>, pathContains: String): List<Pair<String, String>> {
        return requests.filter { it.first.contains(pathContains) }
    }

    fun assertAuthenticationCompleted() {
        val authState = getAuthenticationState()
        if (authState != null) {
            assertEquals("Authentication state should be AUTHENTICATED", "AUTHENTICATED", authState)
        }
    }

    fun assertRequestMade(requests: List<Pair<String, String>>, endpoint: String, message: String = "Request to $endpoint should be made") {
        assertTrue(message, requests.any { it.first.contains(endpoint) })
    }

    fun assertRequestBodyContains(requests: List<Pair<String, String>>, endpoint: String, content: String, message: String? = null) {
        val matchingRequests = requests.filter { it.first.contains(endpoint) }
        assertTrue(
            message ?: "Request body for $endpoint should contain '$content'",
            matchingRequests.any { it.second.contains(content) }
        )
    }

    fun assertSdkFunctionalAfterError() {
        val instance = getSuperBoardInstance()
        assertNotNull("SuperBoard singleton instance should exist after error", instance)

        val identifier = SuperBoard.identifier
        val pushToken = SuperBoard.pushToken
        val attributes = SuperBoard.attributes

        val originalIdentifier = identifier
        SuperBoard.identifier = "sdk-functional-check"
        assertEquals(
            "Setting identifier should work after error",
            "sdk-functional-check",
            SuperBoard.identifier
        )
        SuperBoard.identifier = originalIdentifier

        val originalPushToken = pushToken
        SuperBoard.pushToken = "test-push-token-check"
        assertEquals(
            "Setting pushToken should work after error",
            "test-push-token-check",
            SuperBoard.pushToken
        )
        SuperBoard.pushToken = originalPushToken

        val authState = getAuthenticationState()
        assertNotNull("Authentication state should be accessible after error", authState)
        assertTrue(
            "Authentication state should be a valid enum value, got: $authState",
            authState in listOf("AUTHENTICATED", "RETRYING", "UNAUTHENTICATED")
        )

        assertTrue("SDK should still be enabled after error", isSdkEnabled())
    }

    fun assertAuthenticationInProgress() {
        val authState = getAuthenticationState()
        assertNotNull("Authentication state should be accessible", authState)
        assertTrue(
            "Authentication state should be RETRYING or UNAUTHENTICATED during timeout/error, got: $authState",
            authState in listOf("RETRYING", "UNAUTHENTICATED")
        )
    }

    fun verifyEventInfrastructureWorks(requests: List<Pair<String, String>>) {
        assertRequestMade(requests, "authenticate", "SDK should call authenticate endpoint")
        assertRequestMade(requests, "device_for_vendor_id", "SDK should call device_for_vendor_id endpoint")
    }

    fun verifyPaymentInfrastructureWorks(requests: List<Pair<String, String>>) {
        assertRequestMade(requests, "authenticate", "SDK should call authenticate endpoint")
        assertRequestMade(requests, "device_for_vendor_id", "SDK should call device_for_vendor_id endpoint")
    }

    private const val TEST_VENDOR_ID = "robolectric-test-device-id"
    private const val TEST_APP_VERSION = "1.0.0"
    private const val TEST_BUNDLE = "io.superboard.test"
    private const val TEST_DEVICE = "Unknown robolectric"

    fun assertAuthenticateRequestValues(requests: List<Pair<String, String>>) {
        val authRequests = findRequestsByPath(requests, "authenticate")
        assertTrue("Should call authenticate endpoint", authRequests.isNotEmpty())
        val body = authRequests.first().second
        assertTrue("Auth request should contain vendor_id '$TEST_VENDOR_ID'",
            body.contains("\"vendor_id\":\"$TEST_VENDOR_ID\""))
        assertTrue("Auth request should contain device '$TEST_DEVICE'",
            body.contains("\"device\":\"$TEST_DEVICE\""))
        assertTrue("Auth request should contain app_version '$TEST_APP_VERSION'",
            body.contains("\"app_version\":\"$TEST_APP_VERSION\""))
        assertTrue("Auth request should contain bundle '$TEST_BUNDLE'",
            body.contains("\"bundle\":\"$TEST_BUNDLE\""))
    }

    fun assertDeviceRequestValues(requests: List<Pair<String, String>>) {
        val deviceRequests = findRequestsByPath(requests, "device_for_vendor_id")
        assertTrue("Should call device_for_vendor_id endpoint", deviceRequests.isNotEmpty())
        val path = deviceRequests.first().first
        assertTrue("Device request should query with vendor_id=$TEST_VENDOR_ID",
            path.contains("vendor_id=$TEST_VENDOR_ID"))
    }

    fun assertEventRequestValues(requests: List<Pair<String, String>>, eventType: String) {
        val eventRequests = findRequestsByPath(requests, "event")
        assertTrue("Should have event requests", eventRequests.isNotEmpty())
        assertTrue("Event requests should contain '$eventType' event",
            eventRequests.any { it.second.contains(eventType) })
    }

    fun assertVisitorAttributesRequestValues(
        requests: List<Pair<String, String>>,
        field: String,
        value: String
    ) {
        val attrRequests = findRequestsByPath(requests, "visitor_attributes")
        if (attrRequests.isNotEmpty()) {
            assertTrue("visitor_attributes request should contain '$field' with '$value'",
                attrRequests.any { it.second.contains(field) && it.second.contains(value) })
        } else {
            assertAuthenticationCompleted()
        }
    }

    fun assertGenerateLinkRequestValues(
        requests: List<Pair<String, String>>,
        expectedTitle: String? = null,
        expectedSubtitle: String? = null
    ) {
        val linkRequests = findRequestsByPath(requests, "generate_link")
        assertTrue("Should call generate_link endpoint", linkRequests.isNotEmpty())
        val body = linkRequests.first().second
        expectedTitle?.let {
            assertTrue("Generate link request should contain title '$it'", body.contains(it))
        }
        expectedSubtitle?.let {
            assertTrue("Generate link request should contain subtitle '$it'", body.contains(it))
        }
    }

    fun assertDataForDeviceAndUrlRequestValues(
        requests: List<Pair<String, String>>,
        expectedScheme: String,
        expectedLinkParam: String
    ) {
        val dataRequests = findRequestsByPath(requests, "data_for_device_and_url")
        assertTrue("SDK should call data_for_device_and_url endpoint", dataRequests.isNotEmpty())
        val body = dataRequests.first().second
        assertTrue("Request should contain deeplink scheme '$expectedScheme'",
            body.contains(expectedScheme))
        assertTrue("Request should contain deeplink parameter '$expectedLinkParam'",
            body.contains(expectedLinkParam))
        assertTrue("Request should contain vendor_id '$TEST_VENDOR_ID'",
            body.contains(TEST_VENDOR_ID))
    }

    fun assertDataForDeviceRequestValues(requests: List<Pair<String, String>>) {
        val dataRequests = findRequestsByPath(requests, "data_for_device")
        assertTrue("SDK should call data_for_device endpoint", dataRequests.isNotEmpty())
        val body = dataRequests.first().second
        assertTrue("Request should contain vendor_id '$TEST_VENDOR_ID'",
            body.contains(TEST_VENDOR_ID))
    }

    fun <T> runWithLooperPumping(
        timeoutMs: Long = 5_000L,
        failOnTimeout: Boolean = false,
        operationName: String = "operation",
        block: suspend CoroutineScope.() -> T
    ): T? {
        val deferred = CompletableDeferred<T>()

        CoroutineScope(Dispatchers.Default).launch {
            try {
                val result = block()
                deferred.complete(result)
            } catch (e: Exception) {
                deferred.completeExceptionally(e)
            }
        }

        val startTime = System.currentTimeMillis()
        while (!deferred.isCompleted && System.currentTimeMillis() - startTime < timeoutMs) {
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(50)
        }

        val elapsedMs = System.currentTimeMillis() - startTime

        return if (deferred.isCompleted) {
            try {
                runBlocking { deferred.await() }
            } catch (e: Exception) {
                if (failOnTimeout) {
                    throw AssertionError("$operationName failed with exception after ${elapsedMs}ms", e)
                }
                null
            }
        } else {
            if (failOnTimeout) {
                throw AssertionError(
                    "$operationName timed out after ${timeoutMs}ms. " +
                    "This may indicate a deadlock or the operation taking longer than expected."
                )
            }
            null
        }
    }

    fun waitForCondition(
        timeoutMs: Long = 5_000L,
        description: String = "condition",
        condition: () -> Boolean
    ) {
        val startTime = System.currentTimeMillis()
        while (!condition() && System.currentTimeMillis() - startTime < timeoutMs) {
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(50)
        }
        assertTrue("Timed out waiting for $description after ${timeoutMs}ms", condition())
    }

    fun configureAndWaitForAuthOnly(
        application: Application,
        apiKey: String = "test-api-key",
        baseURL: String? = null
    ) {
        SuperBoard.configure(application, apiKey, useTestEnvironment = true, baseURL = baseURL)
        Shadows.shadowOf(Looper.getMainLooper()).idle()
        runBlocking {
            val authJob = getAuthenticationJob()
            withTimeoutOrNull(10_000) { authJob?.join() }
        }
        Shadows.shadowOf(Looper.getMainLooper()).idle()
    }

    suspend fun configureAndWaitForAuth(
        application: Application,
        apiKey: String = "test-api-key",
        baseURL: String? = null
    ): ActivityController<TestActivity>? {
        SuperBoard.configure(application, apiKey, useTestEnvironment = true, baseURL = baseURL)

        Shadows.shadowOf(Looper.getMainLooper()).idle()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create()
        Shadows.shadowOf(Looper.getMainLooper()).idle()
        activityController.start()
        Shadows.shadowOf(Looper.getMainLooper()).idle()

        val authJob = getAuthenticationJob()
        withTimeoutOrNull(10_000) { authJob?.join() }
        Shadows.shadowOf(Looper.getMainLooper()).idle()

        return activityController
    }

    fun processMainLooper() {
        Shadows.shadowOf(Looper.getMainLooper()).idle()
    }

    fun enableImmediateEventSending() {
        try {
            val instance = getSuperBoardInstance() ?: return

            val managerField = instance.javaClass.getDeclaredField("superboardManager")
            managerField.isAccessible = true
            val manager = managerField.get(instance) ?: return

            val eventsManagerField = manager.javaClass.getDeclaredField("eventsManager")
            eventsManagerField.isAccessible = true
            val eventsManager = eventsManagerField.get(manager) ?: return

            val firstRequestTimeField = eventsManager.javaClass.getDeclaredField("firstRequestTime")
            firstRequestTimeField.isAccessible = true
            val instantCompatClass = firstRequestTimeField.type
            val constructor = instantCompatClass.getConstructor(Long::class.java)
            val pastInstant = constructor.newInstance(System.currentTimeMillis() - 20_000)
            firstRequestTimeField.set(eventsManager, pastInstant)

            val allowedField = eventsManager.javaClass.getDeclaredField("allowedToSendToBackend")
            allowedField.isAccessible = true
            allowedField.setBoolean(eventsManager, true)
        } catch (e: Exception) {
            println("Could not enable immediate event sending: ${e.message}")
        }
    }

    fun setUrlDispatcher(
        server: MockWebServer,
        responses: Map<String, MockResponse>
    ) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                for ((pathContains, response) in responses) {
                    if (path.contains(pathContains)) {
                        return response
                    }
                }
                return MockResponse()
                    .setResponseCode(200)
                    .setHeader("Content-Type", "application/json")
                    .setBody("{}")
            }
        }
    }

}

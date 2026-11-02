package io.superboard.e2e

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import io.superboard.SuperBoard
import io.superboard.utils.InstantCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
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
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class EventTrackingE2ETest {
    private lateinit var mockWebServer: MockWebServer
    private lateinit var application: Application
    private lateinit var capturedEventBodies: MutableList<String>
    private lateinit var capturedPaymentBodies: MutableList<String>

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
        capturedEventBodies = mutableListOf()
        capturedPaymentBodies = mutableListOf()
    }

    @After
    fun tearDown() {
        capturedEventBodies.clear()
        capturedPaymentBodies.clear()
        E2ETestUtils.cleanupMockWebServer(mockWebServer)
    }

    private fun installEventCapturingDispatcher(
        lastSeen: String? = null,
        authResponseCode: Int = 200,
        eventResponseCode: Int = 200
    ) {
        val lastSeenJson = lastSeen?.let { "\"$it\"" } ?: "null"

        mockWebServer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                val body = request.body.clone().readUtf8()

                if (path.contains("add_payment_event")) {
                    synchronized(capturedPaymentBodies) {
                        capturedPaymentBodies.add(body)
                    }
                } else if (path.contains("event")) {
                    synchronized(capturedEventBodies) {
                        capturedEventBodies.add(body)
                    }
                }

                return when {
                    path.contains("authenticate") -> MockResponse()
                        .setResponseCode(authResponseCode)
                        .setHeader("Content-Type", "application/json")
                        .setBody(if (authResponseCode == 200) """{"linksquared":"test-superboard-id-123","uri_scheme":"testapp"}""" else """{"error":"Unauthorized"}""")
                    path.contains("device_for_vendor_id") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("""{"last_seen":$lastSeenJson}""")
                    path.contains("add_payment_event") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("{}")
                    path.contains("event") -> MockResponse()
                        .setResponseCode(eventResponseCode)
                        .setHeader("Content-Type", "application/json")
                        .setBody(if (eventResponseCode == 200) "{}" else """{"error":"Server Error"}""")
                    else -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("{}")
                }
            }
        }
    }

    private fun waitForEvent(eventName: String) {
        E2ETestUtils.waitForCondition(timeoutMs = 10_000, description = "$eventName event sent to backend") {
            E2ETestUtils.enableImmediateEventSending()
            synchronized(capturedEventBodies) {
                capturedEventBodies.any { it.contains("\"event\":\"$eventName\"") }
            }
        }
    }

    private fun assertEventSent(eventName: String) {
        val body = synchronized(capturedEventBodies) {
            capturedEventBodies.first { it.contains("\"event\":\"$eventName\"") }
        }
        assertTrue(
            "Event should have 'event' parameter set to '$eventName', got: ${body.take(300)}",
            body.contains("\"event\":\"$eventName\"")
        )
        assertTrue(
            "Event '$eventName' should have 'created_at' timestamp, got: ${body.take(300)}",
            body.contains("\"created_at\":")
        )
    }

    private fun assertEventHasLink(eventName: String, expectedLink: String) {
        val body = synchronized(capturedEventBodies) {
            capturedEventBodies.last { it.contains("\"event\":\"$eventName\"") }
        }
        assertTrue(
            "Event '$eventName' should have link '$expectedLink', got: ${body.take(300)}",
            body.contains("\"link\":\"$expectedLink\"")
        )
    }

    private fun assertEventHasNoLink(eventName: String) {
        val body = synchronized(capturedEventBodies) {
            capturedEventBodies.first { it.contains("\"event\":\"$eventName\"") }
        }
        val hasNullLink = body.contains("\"link\":null")
        val hasNoLink = !body.contains("\"link\":")
        assertTrue(
            "Event '$eventName' should have null or no link, got: ${body.take(300)}",
            hasNullLink || hasNoLink
        )
    }

    private fun installDeeplinkEventCapturingDispatcher(
        lastSeen: String? = null,
        resolvedLink: String,
        resolvedData: String? = null
    ) {
        val lastSeenJson = lastSeen?.let { "\"$it\"" } ?: "null"
        val dataJson = resolvedData ?: "null"

        mockWebServer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                val body = request.body.clone().readUtf8()

                if (path.contains("add_payment_event")) {
                    synchronized(capturedPaymentBodies) {
                        capturedPaymentBodies.add(body)
                    }
                } else if (path.contains("event")) {
                    synchronized(capturedEventBodies) {
                        capturedEventBodies.add(body)
                    }
                }

                return when {
                    path.contains("authenticate") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("""{"linksquared":"test-superboard-id-123","uri_scheme":"testapp"}""")
                    path.contains("device_for_vendor_id") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("""{"last_seen":$lastSeenJson}""")
                    path.contains("data_for_device") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("""{"link":"$resolvedLink","data":$dataJson}""")
                    path.contains("add_payment_event") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("{}")
                    else -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("{}")
                }
            }
        }
    }

    private fun eventCount(eventName: String): Int {
        return synchronized(capturedEventBodies) {
            capturedEventBodies.count { it.contains("\"event\":\"$eventName\"") }
        }
    }

    private fun getLinkForFutureActions(): String? {
        return try {
            val instance = E2ETestUtils.getSuperBoardInstance()
            val managerField = instance!!.javaClass.getDeclaredField("superboardManager")
            managerField.isAccessible = true
            val manager = managerField.get(instance)
            val eventsManagerField = manager!!.javaClass.getDeclaredField("eventsManager")
            eventsManagerField.isAccessible = true
            val eventsManager = eventsManagerField.get(manager)
            val linkField = eventsManager!!.javaClass.getDeclaredField("linkForFutureActions")
            linkField.isAccessible = true
            linkField.get(eventsManager) as? String
        } catch (e: Exception) {
            println("Could not get linkForFutureActions: ${e.message}")
            null
        }
    }

    @Test
    fun `test SDK sends INSTALL event on first app open`() {
        installEventCapturingDispatcher(lastSeen = null)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start()

        waitForEvent("install")

        E2ETestUtils.assertAuthenticationCompleted()
        assertEventSent("install")

        activityController.stop().destroy()
    }

    @Test
    fun `test SDK sends APP_OPEN event on app open`() {
        installEventCapturingDispatcher(lastSeen = null)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start()

        waitForEvent("app_open")

        E2ETestUtils.assertAuthenticationCompleted()
        assertEventSent("app_open")

        activityController.stop().destroy()
    }

    @Test
    fun `test first app open sends both INSTALL and APP_OPEN events`() {
        installEventCapturingDispatcher(lastSeen = null)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start()

        waitForEvent("install")
        waitForEvent("app_open")

        E2ETestUtils.assertAuthenticationCompleted()
        assertEventSent("install")
        assertEventSent("app_open")

        activityController.stop().destroy()
    }

    @Test
    fun `test SDK sends REINSTALL event when lastSeen is set`() {
        installEventCapturingDispatcher(lastSeen = "2026-01-20T10:00:00.000Z")

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start()

        waitForEvent("reinstall")

        E2ETestUtils.assertAuthenticationCompleted()
        assertEventSent("reinstall")
        assertEquals(
            "Should not send install event for a returning device",
            0, eventCount("install")
        )

        activityController.stop().destroy()
    }

    @Test
    fun `test background to foreground cycle sends pending events`() {
        installEventCapturingDispatcher(lastSeen = null)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start().resume()

        waitForEvent("app_open")

        activityController.pause().stop()

        synchronized(capturedEventBodies) {
            capturedEventBodies.clear()
        }

        activityController.start().resume()

        Thread.sleep(1000)
        E2ETestUtils.enableImmediateEventSending()
        Thread.sleep(1000)

        E2ETestUtils.assertAuthenticationCompleted()

        activityController.pause().stop().destroy()
    }

    @Test
    fun `test no INSTALL event on second app open`() {
        installEventCapturingDispatcher(lastSeen = null)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start()

        waitForEvent("install")
        waitForEvent("app_open")

        val installCountAfterFirstOpen = eventCount("install")
        assertEquals("First open should produce exactly 1 install", 1, installCountAfterFirstOpen)

        activityController.pause().stop()

        activityController.start().resume()

        E2ETestUtils.enableImmediateEventSending()
        Thread.sleep(1000)

        assertEquals(
            "Second foreground cycle should NOT send another install event",
            1, eventCount("install")
        )

        activityController.pause().stop().destroy()
    }

    @Test
    fun `test REINSTALL event includes created_at but no install event`() {
        installEventCapturingDispatcher(lastSeen = "2026-01-15T08:30:00.000Z")

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start()

        waitForEvent("reinstall")
        waitForEvent("app_open")

        E2ETestUtils.assertAuthenticationCompleted()
        assertEventSent("reinstall")
        assertEventSent("app_open")
        assertEquals("Should not send install for returning device", 0, eventCount("install"))

        activityController.stop().destroy()
    }

    @Test
    fun `test events not sent before authentication completes`() {
        mockWebServer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                val body = request.body.clone().readUtf8()

                if (path.contains("event")) {
                    synchronized(capturedEventBodies) {
                        capturedEventBodies.add(body)
                    }
                }

                return when {
                    path.contains("authenticate") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("""{"linksquared":"test-superboard-id-123","uri_scheme":"testapp"}""")
                        .setBodyDelay(3, java.util.concurrent.TimeUnit.SECONDS)
                    path.contains("device_for_vendor_id") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("""{"last_seen":null}""")
                    else -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("{}")
                }
            }
        }

        SuperBoard.configure(application, "test-api-key", useTestEnvironment = true, baseURL = mockWebServer.url("/").toString())

        val eventsBeforeAuth = synchronized(capturedEventBodies) {
            capturedEventBodies.toList()
        }
        assertEquals(
            "No events should be sent before authentication completes",
            0, eventsBeforeAuth.size
        )

        runBlocking {
            val authJob = E2ETestUtils.getAuthenticationJob()
            withTimeoutOrNull(10_000) { authJob?.join() }
        }

        E2ETestUtils.enableImmediateEventSending()
        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start()

        waitForEvent("install")

        E2ETestUtils.assertAuthenticationCompleted()
        assertEventSent("install")

        activityController.stop().destroy()
    }

    @Test
    fun `test events without deeplink have no link attribution`() {
        installEventCapturingDispatcher(lastSeen = null)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start()

        waitForEvent("install")
        waitForEvent("app_open")

        assertEventHasNoLink("install")
        assertEventHasNoLink("app_open")

        activityController.stop().destroy()
    }

    @Test
    fun `test cold start deeplink attributes link to install event`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            installDeeplinkEventCapturingDispatcher(
                lastSeen = null,
                resolvedLink = "https://test.superboard.io/campaign123"
            )

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val deeplinkIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("testapp://open?link=campaign123")
            }
            val activityController = Robolectric.buildActivity(TestActivity::class.java, deeplinkIntent)
            activityController.create()

            SuperBoard.setOnDeeplinkReceivedListener(activityController.get()) { _ -> }
            activityController.start()

            Thread.sleep(2000)

            E2ETestUtils.enableImmediateEventSending()

            activityController.pause().stop()
            activityController.start().resume()

            E2ETestUtils.waitForCondition(timeoutMs = 10_000, description = "install event with link attribution") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    capturedEventBodies.any {
                        it.contains("\"event\":\"install\"") && it.contains("\"link\":\"https://test.superboard.io/campaign123\"")
                    }
                }
            }

            assertEventHasLink("install", "https://test.superboard.io/campaign123")

            activityController.stop().destroy()
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `test cold start deeplink attributes link to app_open event`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            installDeeplinkEventCapturingDispatcher(
                lastSeen = null,
                resolvedLink = "https://test.superboard.io/promo"
            )

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val deeplinkIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("testapp://open?link=promo")
            }
            val activityController = Robolectric.buildActivity(TestActivity::class.java, deeplinkIntent)
            activityController.create()

            SuperBoard.setOnDeeplinkReceivedListener(activityController.get()) { _ -> }
            activityController.start()

            Thread.sleep(2000)

            E2ETestUtils.enableImmediateEventSending()
            activityController.pause().stop()
            activityController.start().resume()

            E2ETestUtils.waitForCondition(timeoutMs = 10_000, description = "app_open event with link attribution") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    capturedEventBodies.any {
                        it.contains("\"event\":\"app_open\"") && it.contains("\"link\":\"https://test.superboard.io/promo\"")
                    }
                }
            }

            assertEventHasLink("app_open", "https://test.superboard.io/promo")

            activityController.stop().destroy()
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `test deeplink attributes link to reinstall event`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            installDeeplinkEventCapturingDispatcher(
                lastSeen = "2026-01-10T12:00:00.000Z",
                resolvedLink = "https://test.superboard.io/welcome-back"
            )

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val deeplinkIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("testapp://open?link=welcome-back")
            }
            val activityController = Robolectric.buildActivity(TestActivity::class.java, deeplinkIntent)
            activityController.create()

            SuperBoard.setOnDeeplinkReceivedListener(activityController.get()) { _ -> }
            activityController.start()

            Thread.sleep(2000)

            E2ETestUtils.enableImmediateEventSending()
            activityController.pause().stop()
            activityController.start().resume()

            E2ETestUtils.waitForCondition(timeoutMs = 10_000, description = "reinstall event with link attribution") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    capturedEventBodies.any {
                        it.contains("\"event\":\"reinstall\"") && it.contains("\"link\":\"https://test.superboard.io/welcome-back\"")
                    }
                }
            }

            assertEventHasLink("reinstall", "https://test.superboard.io/welcome-back")
            assertEquals("Should not send install for returning device", 0, eventCount("install"))

            activityController.stop().destroy()
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `test cold start deeplink attributes link to both install and app_open`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            installDeeplinkEventCapturingDispatcher(
                lastSeen = null,
                resolvedLink = "https://test.superboard.io/both-events"
            )

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val deeplinkIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("testapp://open?link=both-events")
            }
            val activityController = Robolectric.buildActivity(TestActivity::class.java, deeplinkIntent)
            activityController.create()

            SuperBoard.setOnDeeplinkReceivedListener(activityController.get()) { _ -> }
            activityController.start()

            Thread.sleep(2000)

            E2ETestUtils.enableImmediateEventSending()
            activityController.pause().stop()
            activityController.start().resume()

            E2ETestUtils.waitForCondition(timeoutMs = 10_000, description = "install event with link") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    capturedEventBodies.any {
                        it.contains("\"event\":\"install\"") && it.contains("\"link\":\"https://test.superboard.io/both-events\"")
                    }
                }
            }
            E2ETestUtils.waitForCondition(timeoutMs = 10_000, description = "app_open event with link") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    capturedEventBodies.any {
                        it.contains("\"event\":\"app_open\"") && it.contains("\"link\":\"https://test.superboard.io/both-events\"")
                    }
                }
            }

            assertEventHasLink("install", "https://test.superboard.io/both-events")
            assertEventHasLink("app_open", "https://test.superboard.io/both-events")

            activityController.stop().destroy()
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `test SDK handles event endpoint server error without crashing`() {
        installEventCapturingDispatcher(lastSeen = null, eventResponseCode = 500)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start()

        Thread.sleep(2000)

        E2ETestUtils.assertAuthenticationCompleted()
        E2ETestUtils.assertSdkFunctionalAfterError()

        activityController.stop().destroy()
    }

    @Test
    fun `test SDK remains functional after multiple background foreground cycles`() {
        installEventCapturingDispatcher(lastSeen = null)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start().resume()

        waitForEvent("install")
        waitForEvent("app_open")

        val installCountAfterLaunch = eventCount("install")
        val appOpenCountAfterLaunch = eventCount("app_open")

        repeat(3) {
            activityController.pause().stop()
            Thread.sleep(1000)

            activityController.start().resume()
            E2ETestUtils.setNumStarted(1)
            E2ETestUtils.enableImmediateEventSending()
            Thread.sleep(1000)
        }

        E2ETestUtils.assertAuthenticationCompleted()
        E2ETestUtils.assertSdkFunctionalAfterError()

        assertEquals(
            "Install event should be sent exactly once despite 3 foreground cycles",
            1, eventCount("install")
        )
        assertEquals(
            "Install count should not change after initial launch",
            installCountAfterLaunch, eventCount("install")
        )

        assertEquals(
            "app_open event should be sent exactly once (only on initial launch)",
            appOpenCountAfterLaunch, eventCount("app_open")
        )

        assertEquals(
            "No reinstall event should be sent for a new device",
            0, eventCount("reinstall")
        )

        assertTrue(
            "MockWebServer should have received multiple requests, got: ${mockWebServer.requestCount}",
            mockWebServer.requestCount >= 3
        )

        activityController.pause().stop().destroy()
    }

    @Test
    fun `test reinstall also sends app_open event`() {
        installEventCapturingDispatcher(lastSeen = "2026-01-10T12:00:00.000Z")

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start()

        waitForEvent("reinstall")
        waitForEvent("app_open")

        assertEventSent("reinstall")
        assertEventSent("app_open")
        assertEquals("Should not send install for returning device", 0, eventCount("install"))
        assertTrue("Should have at least 1 reinstall event", eventCount("reinstall") >= 1)
        assertTrue("Should have at least 1 app_open event", eventCount("app_open") >= 1)

        activityController.stop().destroy()
    }

    private fun seedLocalCache(daysAgo: Int, opens: Int) {
        val prefs = application.getSharedPreferences("SuperBoardStorage", Context.MODE_PRIVATE)
        prefs.edit()
            .putInt("superboard_number_of_opens", opens)
            .putString(
                "superboard_last_start_timestamp",
                InstantCompat(System.currentTimeMillis() - daysAgo.toLong() * 24 * 60 * 60 * 1000).toString()
            )
            .commit()
    }

    @Test
    fun `test reactivation event with deeplink gets resolved link`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            seedLocalCache(daysAgo = 8, opens = 5)

            installDeeplinkEventCapturingDispatcher(
                lastSeen = "2026-01-20T10:00:00.000Z",
                resolvedLink = "https://test.superboard.io/reactivation-campaign"
            )

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val deeplinkIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("testapp://open?link=reactivation-campaign")
            }
            val activityController = Robolectric.buildActivity(TestActivity::class.java, deeplinkIntent)
            activityController.create()

            SuperBoard.setOnDeeplinkReceivedListener(activityController.get()) { _ -> }
            activityController.start()

            Thread.sleep(2000)

            E2ETestUtils.enableImmediateEventSending()
            activityController.pause().stop()
            activityController.start().resume()

            E2ETestUtils.waitForCondition(timeoutMs = 10_000, description = "reactivation launch events with link") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    val hasReactivation = capturedEventBodies.any {
                        it.contains("\"event\":\"reactivation\"") &&
                            it.contains("\"link\":\"https://test.superboard.io/reactivation-campaign\"")
                    }
                    val hasAppOpen = capturedEventBodies.any {
                        it.contains("\"event\":\"app_open\"") &&
                            it.contains("\"link\":\"https://test.superboard.io/reactivation-campaign\"")
                    }
                    hasReactivation && hasAppOpen
                }
            }

            assertEventHasLink("reactivation", "https://test.superboard.io/reactivation-campaign")
            assertEventHasLink("app_open", "https://test.superboard.io/reactivation-campaign")
            assertEquals("No install event for a returning user with opens > 0", 0, eventCount("install"))
            assertEquals("No reinstall event for a returning user with opens > 0", 0, eventCount("reinstall"))

            activityController.stop().destroy()
        } finally {
            Dispatchers.resetMain()
        }
    }

    private fun installDeferredAttributionDispatcher(
        lastSeen: String? = null,
        resolvedLink: String,
        delaySeconds: Long = 3
    ) {
        val lastSeenJson = lastSeen?.let { "\"$it\"" } ?: "null"

        mockWebServer.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                val body = request.body.clone().readUtf8()

                if (path.contains("add_payment_event")) {
                    synchronized(capturedPaymentBodies) {
                        capturedPaymentBodies.add(body)
                    }
                } else if (path.contains("event")) {
                    synchronized(capturedEventBodies) {
                        capturedEventBodies.add(body)
                    }
                }

                return when {
                    path.contains("authenticate") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("""{"linksquared":"test-superboard-id-123","uri_scheme":"testapp"}""")
                    path.contains("device_for_vendor_id") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("""{"last_seen":$lastSeenJson}""")
                    path.contains("data_for_device") -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("""{"link":"$resolvedLink","data":null}""")
                        .setBodyDelay(delaySeconds, java.util.concurrent.TimeUnit.SECONDS)
                    else -> MockResponse()
                        .setResponseCode(200)
                        .setHeader("Content-Type", "application/json")
                        .setBody("{}")
                }
            }
        }
    }

    @Test
    fun `test install event gets resolved link via deferred attribution`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            installDeferredAttributionDispatcher(
                lastSeen = null,
                resolvedLink = "https://test.superboard.io/deferred-install"
            )

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val activityController = Robolectric.buildActivity(TestActivity::class.java)
            activityController.create()
            activityController.start()

            val eventsSentDuringDelay = synchronized(capturedEventBodies) {
                capturedEventBodies.filter { it.contains("\"event\":\"install\"") }
            }
            assertTrue(
                "Install event should NOT be sent to backend while data_for_device is pending",
                eventsSentDuringDelay.isEmpty()
            )

            Thread.sleep(4000)

            E2ETestUtils.enableImmediateEventSending()
            activityController.pause().stop()
            activityController.start().resume()

            E2ETestUtils.waitForCondition(timeoutMs = 10_000, description = "install event with deferred attribution link") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    capturedEventBodies.any {
                        it.contains("\"event\":\"install\"") && it.contains("\"link\":\"https://test.superboard.io/deferred-install\"")
                    }
                }
            }

            assertEventHasLink("install", "https://test.superboard.io/deferred-install")

            activityController.stop().destroy()
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `test reinstall event gets resolved link via deferred attribution`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            installDeferredAttributionDispatcher(
                lastSeen = "2026-01-10T12:00:00.000Z",
                resolvedLink = "https://test.superboard.io/deferred-reinstall"
            )

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val activityController = Robolectric.buildActivity(TestActivity::class.java)
            activityController.create()
            activityController.start()

            val eventsSentDuringDelay = synchronized(capturedEventBodies) {
                capturedEventBodies.filter { it.contains("\"event\":\"reinstall\"") }
            }
            assertTrue(
                "Reinstall event should NOT be sent to backend while data_for_device is pending",
                eventsSentDuringDelay.isEmpty()
            )

            Thread.sleep(4000)

            E2ETestUtils.enableImmediateEventSending()
            activityController.pause().stop()
            activityController.start().resume()

            E2ETestUtils.waitForCondition(timeoutMs = 10_000, description = "reinstall event with deferred attribution link") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    capturedEventBodies.any {
                        it.contains("\"event\":\"reinstall\"") && it.contains("\"link\":\"https://test.superboard.io/deferred-reinstall\"")
                    }
                }
            }

            assertEventHasLink("reinstall", "https://test.superboard.io/deferred-reinstall")
            assertEquals("Should not send install for returning device", 0, eventCount("install"))

            activityController.stop().destroy()
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `test app_open event gets resolved link via deferred attribution`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            installDeferredAttributionDispatcher(
                lastSeen = null,
                resolvedLink = "https://test.superboard.io/deferred-appopen"
            )

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val activityController = Robolectric.buildActivity(TestActivity::class.java)
            activityController.create()
            activityController.start()

            val eventsSentDuringDelay = synchronized(capturedEventBodies) {
                capturedEventBodies.filter { it.contains("\"event\":\"app_open\"") }
            }
            assertTrue(
                "app_open event should NOT be sent to backend while data_for_device is pending",
                eventsSentDuringDelay.isEmpty()
            )

            Thread.sleep(4000)

            E2ETestUtils.enableImmediateEventSending()
            activityController.pause().stop()
            activityController.start().resume()

            E2ETestUtils.waitForCondition(timeoutMs = 10_000, description = "app_open event with deferred attribution link") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    capturedEventBodies.any {
                        it.contains("\"event\":\"app_open\"") && it.contains("\"link\":\"https://test.superboard.io/deferred-appopen\"")
                    }
                }
            }

            assertEventHasLink("app_open", "https://test.superboard.io/deferred-appopen")

            activityController.stop().destroy()
        } finally {
            Dispatchers.resetMain()
        }
    }

    private fun assertTimeSpentEventSent() {
        val body = synchronized(capturedEventBodies) {
            capturedEventBodies.first { it.contains("\"event\":\"time_spent\"") }
        }
        assertTrue(
            "TIME_SPENT event should have 'event' field set to 'time_spent', got: ${body.take(300)}",
            body.contains("\"event\":\"time_spent\"")
        )
        assertTrue(
            "TIME_SPENT event should have 'created_at' timestamp, got: ${body.take(300)}",
            body.contains("\"created_at\":")
        )
    }

    private fun assertTimeSpentHasEngagementTime() {
        val body = synchronized(capturedEventBodies) {
            capturedEventBodies.first { it.contains("\"event\":\"time_spent\"") }
        }
        assertTrue(
            "TIME_SPENT event should have 'engagement_time' field, got: ${body.take(300)}",
            body.contains("\"engagement_time\":")
        )
        assertFalse(
            "TIME_SPENT event should not have null engagement_time, got: ${body.take(300)}",
            body.contains("\"engagement_time\":null")
        )
    }

    private fun assertTimeSpentHasLink(expectedLink: String) {
        val body = synchronized(capturedEventBodies) {
            capturedEventBodies.last { it.contains("\"event\":\"time_spent\"") }
        }
        assertTrue(
            "TIME_SPENT event should have link '$expectedLink', got: ${body.take(300)}",
            body.contains("\"link\":\"$expectedLink\"")
        )
    }

    private fun assertTimeSpentHasNoLink() {
        val body = synchronized(capturedEventBodies) {
            capturedEventBodies.first { it.contains("\"event\":\"time_spent\"") }
        }
        val hasNullLink = body.contains("\"link\":null")
        val hasNoLink = !body.contains("\"link\":")
        assertTrue(
            "TIME_SPENT event should have null or no link, got: ${body.take(300)}",
            hasNullLink || hasNoLink
        )
    }

    private fun performBackgroundForegroundCycle(
        activityController: org.robolectric.android.controller.ActivityController<TestActivity>
    ) {
        activityController.pause().stop()

        activityController.start().resume()
        E2ETestUtils.setNumStarted(1)
        E2ETestUtils.enableImmediateEventSending()
        Thread.sleep(3000)
    }

    @Test
    fun `test TIME_SPENT event is sent after background foreground cycle`() {
        installEventCapturingDispatcher(lastSeen = null)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start().resume()

        waitForEvent("install")
        Thread.sleep(2000)

        performBackgroundForegroundCycle(activityController)

        E2ETestUtils.waitForCondition(timeoutMs = 15_000, description = "time_spent event sent to backend") {
            E2ETestUtils.enableImmediateEventSending()
            synchronized(capturedEventBodies) {
                capturedEventBodies.any { it.contains("\"event\":\"time_spent\"") }
            }
        }

        assertTimeSpentEventSent()
        assertTimeSpentHasEngagementTime()

        activityController.pause().stop().destroy()
    }

    @Test
    fun `test TIME_SPENT event without deeplink has no link attribution`() {
        installEventCapturingDispatcher(lastSeen = null)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start().resume()

        waitForEvent("install")
        Thread.sleep(2000)

        performBackgroundForegroundCycle(activityController)

        E2ETestUtils.waitForCondition(timeoutMs = 15_000, description = "time_spent event without link") {
            E2ETestUtils.enableImmediateEventSending()
            synchronized(capturedEventBodies) {
                capturedEventBodies.any { it.contains("\"event\":\"time_spent\"") }
            }
        }

        assertTimeSpentEventSent()
        assertTimeSpentHasNoLink()

        activityController.pause().stop().destroy()
    }

    @Test
    fun `test TIME_SPENT event carries deeplink link when set before backgrounding`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            installDeeplinkEventCapturingDispatcher(
                lastSeen = null,
                resolvedLink = "https://test.superboard.io/time-spent-link"
            )

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val deeplinkIntent = Intent(Intent.ACTION_VIEW).apply {
                data = Uri.parse("testapp://open?link=time-spent-link")
            }
            val activityController = Robolectric.buildActivity(TestActivity::class.java, deeplinkIntent)
            activityController.create()

            SuperBoard.setOnDeeplinkReceivedListener(activityController.get()) { _ -> }
            activityController.start()

            Thread.sleep(3000)

            activityController.resume()

            performBackgroundForegroundCycle(activityController)

            E2ETestUtils.waitForCondition(timeoutMs = 15_000, description = "time_spent event with deeplink") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    capturedEventBodies.any {
                        it.contains("\"event\":\"time_spent\"") &&
                            it.contains("\"link\":\"https://test.superboard.io/time-spent-link\"")
                    }
                }
            }

            assertTimeSpentHasLink("https://test.superboard.io/time-spent-link")
            assertTimeSpentHasEngagementTime()

            activityController.stop().destroy()
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `test TIME_SPENT event is not retroactively patched by deeplink resolution`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        try {
            installDeferredAttributionDispatcher(
                lastSeen = null,
                resolvedLink = "https://test.superboard.io/not-for-timespent"
            )

            E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())

            val activityController = Robolectric.buildActivity(TestActivity::class.java)
            activityController.create().start().resume()

            Thread.sleep(5000)

            performBackgroundForegroundCycle(activityController)

            E2ETestUtils.waitForCondition(timeoutMs = 15_000, description = "time_spent events sent") {
                E2ETestUtils.enableImmediateEventSending()
                synchronized(capturedEventBodies) {
                    capturedEventBodies.any { it.contains("\"event\":\"time_spent\"") }
                }
            }

            val timeSpentEvents = synchronized(capturedEventBodies) {
                capturedEventBodies.filter { it.contains("\"event\":\"time_spent\"") }
            }
            assertTrue("At least one TIME_SPENT event should be sent", timeSpentEvents.isNotEmpty())

            val firstTimeSpent = timeSpentEvents.first()
            val firstHasNullLink = firstTimeSpent.contains("\"link\":null")
            val firstHasNoLink = !firstTimeSpent.contains("\"link\":")
            assertTrue(
                "First TIME_SPENT (created before link resolution) should have null link, got: ${firstTimeSpent.take(400)}",
                firstHasNullLink || firstHasNoLink
            )

            if (timeSpentEvents.size >= 2) {
                val secondTimeSpent = timeSpentEvents[1]
                assertTrue(
                    "Second TIME_SPENT (created after link resolution) should have the resolved link, got: ${secondTimeSpent.take(400)}",
                    secondTimeSpent.contains("\"link\":\"https://test.superboard.io/not-for-timespent\"")
                )
            }

            activityController.stop().destroy()
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `test multiple background foreground cycles produce multiple TIME_SPENT events`() {
        installEventCapturingDispatcher(lastSeen = null)

        E2ETestUtils.configureAndWaitForAuthOnly(application, baseURL = mockWebServer.url("/").toString())
        E2ETestUtils.enableImmediateEventSending()

        val activityController = Robolectric.buildActivity(TestActivity::class.java)
        activityController.create().start().resume()
        E2ETestUtils.setNumStarted(1)

        waitForEvent("install")
        Thread.sleep(2000)

        repeat(3) {
            performBackgroundForegroundCycle(activityController)
        }

        E2ETestUtils.waitForCondition(timeoutMs = 15_000, description = "time_spent events from multiple cycles") {
            E2ETestUtils.enableImmediateEventSending()
            synchronized(capturedEventBodies) {
                capturedEventBodies.any { it.contains("\"event\":\"time_spent\"") }
            }
        }

        val timeSpentCount = synchronized(capturedEventBodies) {
            capturedEventBodies.count { it.contains("\"event\":\"time_spent\"") }
        }
        assertTrue(
            "Expected multiple TIME_SPENT events after 3 bg/fg cycles, got: $timeSpentCount",
            timeSpentCount >= 2
        )

        val timeSpentEvents = synchronized(capturedEventBodies) {
            capturedEventBodies.filter { it.contains("\"event\":\"time_spent\"") }
        }
        timeSpentEvents.forEach { body ->
            assertTrue(
                "Each TIME_SPENT event should have engagement_time, got: ${body.take(300)}",
                body.contains("\"engagement_time\":")
            )
            assertFalse(
                "Each TIME_SPENT event should not have null engagement_time, got: ${body.take(300)}",
                body.contains("\"engagement_time\":null")
            )
        }

        activityController.pause().stop().destroy()
    }
}

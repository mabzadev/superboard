package io.superboard.handlers

import android.app.Application
import android.content.Context
import io.superboard.TestAssertions.assertAllowedToSendToBackend
import io.superboard.TestAssertions.assertEqualsWithContext
import io.superboard.TestAssertions.assertNotNullWithContext
import io.superboard.TestAssertions.assertNullWithContext
import io.superboard.TestAssertions.assertTrueWithContext
import io.superboard.TestAssertions.assertEventStored
// PURCHASE_EVENT_DISABLED: import io.superboard.TestAssertions.assertPaymentEventStored
import io.superboard.model.DebugLogger
import io.superboard.model.Event
import io.superboard.model.EventType
import io.superboard.model.LogLevel
// PURCHASE_EVENT_DISABLED: import io.superboard.model.events.PaymentEvent
// PURCHASE_EVENT_DISABLED: import io.superboard.model.events.PaymentEventType
import io.superboard.service.ISuperBoardService
import io.superboard.storage.IEventsStorage
import io.superboard.storage.ILocalCache
import io.superboard.utils.InstantCompat
import io.superboard.utils.LSResult
import io.mockk.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Core unit tests for EventsManager.
 */
@ExperimentalCoroutinesApi
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class EventsManagerTest {

    private lateinit var context: Context
    private lateinit var application: Application
    private lateinit var superboardContext: SuperBoardContext
    private lateinit var mockSuperBoardService: ISuperBoardService
    private lateinit var mockEventsStorage: IEventsStorage
    private lateinit var mockLocalCache: ILocalCache
    private lateinit var eventsManager: EventsManager

    private val testApiKey = "test-api-key-123"

    @Before
    fun setUp() {
        MockKAnnotations.init(this, relaxed = true)

        context = RuntimeEnvironment.getApplication()
        application = RuntimeEnvironment.getApplication()

        superboardContext = SuperBoardContext()
        superboardContext.settings.sdkEnabled = true

        mockSuperBoardService = mockk(relaxed = true)
        mockEventsStorage = mockk(relaxed = true)
        mockLocalCache = mockk(relaxed = true)

        coEvery { mockEventsStorage.getEvents() } returns emptyList()
        // PURCHASE_EVENT_DISABLED: coEvery { mockEventsStorage.getPaymentEvents() } returns emptyList()
        coEvery { mockEventsStorage.hasEmptyTimeSpentEvent() } returns false
        every { mockLocalCache.numberOfOpens } returns 0
        every { mockLocalCache.resignTimestamp } returns null
        every { mockLocalCache.lastStartTimestamp } returns null

        DebugLogger.instance.logLevel = LogLevel.INFO

        eventsManager = EventsManager(
            context = context,
            superboardContext = superboardContext,
            apiKey = testApiKey,
            superboardService = mockSuperBoardService,
            eventsStorage = mockEventsStorage,
            localCache = mockLocalCache
        )
    }

    @After
    fun tearDown() {
        unmockkAll()
    }

    // ==================== Constructor Tests ====================

    @Test
    fun `EventsManager constructor initializes with provided context`() {
        assertNotNullWithContext(
            eventsManager.context,
            "context",
            "after construction with test context"
        )
        assertEqualsWithContext(
            context,
            eventsManager.context,
            "context",
            "after construction with test context"
        )
    }

    @Test
    fun `EventsManager allowedToSendToBackend is false when newly constructed`() {
        assertAllowedToSendToBackend(
            eventsManager,
            expected = false,
            context = "after construction with default settings"
        )
    }

    // ==================== App Lifecycle Tests ====================

    @Test
    fun `EventsManager onAppForegrounded sends queued events to backend when sending allowed`() = runTest {
        eventsManager.allowedToSendToBackend = true
        eventsManager.firstRequestTime = InstantCompat.now()

        val testEvent = Event(EventType.APP_OPEN, InstantCompat.now())
        coEvery { mockEventsStorage.getEvents() } returns listOf(testEvent)
        coEvery { mockSuperBoardService.addEvent(any()) } returns LSResult.Success(true)
        coEvery { mockEventsStorage.removeEvent(any()) } returns Unit

        eventsManager.onAppForegrounded()

        coVerify { mockEventsStorage.getEvents() }
        coVerify(timeout = 1000) { mockSuperBoardService.addEvent(testEvent) }
    }

    @Test
    fun `EventsManager onAppBackgrounded sets resignTimestamp in localCache`() {
        eventsManager.onAppBackgrounded()

        verify { mockLocalCache.resignTimestamp = any() }
    }

    @Test
    fun `EventsManager onAppBackgrounded clears linkForFutureActions`() {
        eventsManager.linkForFutureActions = "https://test.link"

        eventsManager.onAppBackgrounded()

        assertNullWithContext(
            eventsManager.linkForFutureActions,
            "linkForFutureActions",
            "after onAppBackgrounded() with link previously set to 'https://test.link'"
        )
    }

    @Test
    fun `EventsManager foreground waits for background TIME_SPENT finalization before sending`() = runTest {
        val finalizationStarted = CompletableDeferred<Unit>()
        val allowFinalization = CompletableDeferred<Unit>()
        var finalizationCompleted = false
        val finalizedTimeSpent = Event(
            event = EventType.TIME_SPENT,
            createdAt = InstantCompat.now(),
            engagementTime = 2
        )

        eventsManager = EventsManager(
            context = context,
            superboardContext = superboardContext,
            apiKey = testApiKey,
            superboardService = mockSuperBoardService,
            eventsStorage = mockEventsStorage,
            localCache = mockLocalCache
        )
        eventsManager.timeSpentScope = this
        eventsManager.allowedToSendToBackend = true
        eventsManager.firstRequestTime = InstantCompat.now()

        coEvery {
            mockEventsStorage.markTimeSpentNode(
                startingNode = false,
                endingNode = true,
                link = null
            )
        } coAnswers {
            finalizationStarted.complete(Unit)
            allowFinalization.await()
            finalizationCompleted = true
        }
        coEvery { mockEventsStorage.getEvents() } answers {
            if (finalizationCompleted) listOf(finalizedTimeSpent) else emptyList()
        }
        coEvery { mockSuperBoardService.addEvent(finalizedTimeSpent) } coAnswers {
            assertTrue("TIME_SPENT must be finalized before it is sent", finalizationCompleted)
            LSResult.Success(true)
        }

        eventsManager.onAppBackgrounded()
        runCurrent()
        finalizationStarted.await()

        val foreground = async { eventsManager.onAppForegrounded() }
        runCurrent()
        coVerify(exactly = 0) { mockSuperBoardService.addEvent(any()) }

        allowFinalization.complete(Unit)
        foreground.await()

        coVerify(exactly = 1) { mockSuperBoardService.addEvent(finalizedTimeSpent) }
        coVerifyOrder {
            mockEventsStorage.markTimeSpentNode(
                startingNode = false,
                endingNode = true,
                link = null
            )
            mockSuperBoardService.addEvent(finalizedTimeSpent)
            mockEventsStorage.markTimeSpentNode(
                startingNode = true,
                endingNode = false,
                link = null
            )
        }
    }

    // ==================== Launch Events Tests ====================

    @Test
    fun `EventsManager logAppLaunchEvents stores INSTALL event when numberOfOpens is zero`() = runTest {
        every { mockLocalCache.numberOfOpens } returns 0

        eventsManager.logAppLaunchEvents()

        assertEventStored(
            eventType = EventType.INSTALL,
            mockStorage = mockEventsStorage,
            context = "after logAppLaunchEvents() with numberOfOpens=0 (first launch)"
        )
    }

    @Test
    fun `EventsManager logAppLaunchEvents stores REINSTALL event when lastSeen exists on first launch`() = runTest {
        every { mockLocalCache.numberOfOpens } returns 0
        superboardContext.lastSeen = InstantCompat.now()

        eventsManager.logAppLaunchEvents()

        assertEventStored(
            eventType = EventType.REINSTALL,
            mockStorage = mockEventsStorage,
            context = "after logAppLaunchEvents() with numberOfOpens=0 and lastSeen set"
        )
    }

    @Test
    fun `EventsManager logAppLaunchEvents stores REACTIVATION event when inactive for 7+ days`() = runTest {
        every { mockLocalCache.numberOfOpens } returns 5
        val eightDaysAgo = InstantCompat.now().minusMillis(8L * 24 * 60 * 60 * 1000)
        every { mockLocalCache.lastStartTimestamp } returns eightDaysAgo

        eventsManager.logAppLaunchEvents()

        assertEventStored(
            eventType = EventType.REACTIVATION,
            mockStorage = mockEventsStorage,
            context = "after logAppLaunchEvents() with lastStartTimestamp 8 days ago"
        )
    }

    @Test
    fun `EventsManager logAppLaunchEvents stores APP_OPEN event on subsequent launches`() = runTest {
        every { mockLocalCache.numberOfOpens } returns 1

        eventsManager.logAppLaunchEvents()

        assertEventStored(
            eventType = EventType.APP_OPEN,
            mockStorage = mockEventsStorage,
            context = "after logAppLaunchEvents() with numberOfOpens=1"
        )
    }

    // ==================== Event Logging Tests ====================

    @Test
    fun `EventsManager log stores event in storage`() = runTest {
        eventsManager.allowedToSendToBackend = true
        eventsManager.firstRequestTime = InstantCompat.now()

        val event = Event(EventType.VIEW, InstantCompat.now())

        eventsManager.log(event)

        coVerify { mockEventsStorage.addEvent(event) }
    }

    @Test
    fun `EventsManager log sets linkForFutureActions on event when link not already set`() = runTest {
        eventsManager.linkForFutureActions = "https://test.link"
        eventsManager.allowedToSendToBackend = true
        eventsManager.firstRequestTime = InstantCompat.now()

        val event = Event(EventType.VIEW, InstantCompat.now())

        eventsManager.log(event)

        coVerify { mockEventsStorage.addEvent(match { it.link == "https://test.link" }) }
    }

    @Test
    fun `EventsManager log sends events to backend when allowed`() = runTest {
        eventsManager.allowedToSendToBackend = true
        eventsManager.firstRequestTime = InstantCompat.now()

        val event = Event(EventType.VIEW, InstantCompat.now())
        coEvery { mockEventsStorage.getEvents() } returns listOf(event)
        coEvery { mockSuperBoardService.addEvent(any()) } returns LSResult.Success(true)

        eventsManager.log(event)

        coVerify { mockSuperBoardService.addEvent(any()) }
    }

    // ==================== Purchase Tests ====================

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `EventsManager logInAppPurchase parses originalJson and stores payment event`() = runTest {
    // PURCHASE_EVENT_DISABLED:     eventsManager.allowedToSendToBackend = true
    // PURCHASE_EVENT_DISABLED:     eventsManager.firstRequestTime = InstantCompat.now()
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     val originalJson = """
    // PURCHASE_EVENT_DISABLED:         {
    // PURCHASE_EVENT_DISABLED:             "orderId": "GPA.1234-5678",
    // PURCHASE_EVENT_DISABLED:             "packageName": "io.superboard.test",
    // PURCHASE_EVENT_DISABLED:             "productId": "premium_subscription",
    // PURCHASE_EVENT_DISABLED:             "purchaseTime": 1234567890000,
    // PURCHASE_EVENT_DISABLED:             "purchaseState": 0,
    // PURCHASE_EVENT_DISABLED:             "purchaseToken": "token123"
    // PURCHASE_EVENT_DISABLED:         }
    // PURCHASE_EVENT_DISABLED:     """.trimIndent()
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     eventsManager.logInAppPurchase(originalJson)
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     coVerify { mockEventsStorage.addPaymentEvent(any()) }
    // PURCHASE_EVENT_DISABLED: }

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `EventsManager logCustomPurchase stores payment event with correct type`() = runTest {
    // PURCHASE_EVENT_DISABLED:     eventsManager.allowedToSendToBackend = true
    // PURCHASE_EVENT_DISABLED:     eventsManager.firstRequestTime = InstantCompat.now()
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     eventsManager.logCustomPurchase(
    // PURCHASE_EVENT_DISABLED:         type = PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:         priceInCents = 999,
    // PURCHASE_EVENT_DISABLED:         currency = "USD",
    // PURCHASE_EVENT_DISABLED:         productId = "premium"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     assertPaymentEventStored(
    // PURCHASE_EVENT_DISABLED:         eventType = PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:         mockStorage = mockEventsStorage,
    // PURCHASE_EVENT_DISABLED:         context = "after logCustomPurchase() with type=BUY"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED: }

    // PURCHASE_EVENT_DISABLED: @Test
    // PURCHASE_EVENT_DISABLED: fun `EventsManager logCustomPurchase includes linkForFutureActions on payment event`() = runTest {
    // PURCHASE_EVENT_DISABLED:     eventsManager.linkForFutureActions = "https://test.link"
    // PURCHASE_EVENT_DISABLED:     eventsManager.allowedToSendToBackend = true
    // PURCHASE_EVENT_DISABLED:     eventsManager.firstRequestTime = InstantCompat.now()
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     eventsManager.logCustomPurchase(
    // PURCHASE_EVENT_DISABLED:         type = PaymentEventType.BUY,
    // PURCHASE_EVENT_DISABLED:         priceInCents = 999,
    // PURCHASE_EVENT_DISABLED:         currency = "USD",
    // PURCHASE_EVENT_DISABLED:         productId = "premium"
    // PURCHASE_EVENT_DISABLED:     )
    // PURCHASE_EVENT_DISABLED:
    // PURCHASE_EVENT_DISABLED:     coVerify { mockEventsStorage.addPaymentEvent(match { it.link == "https://test.link" }) }
    // PURCHASE_EVENT_DISABLED: }

    // ==================== Link Association Tests ====================

    @Test
    fun `EventsManager setLinkToNewFutureActions sets linkForFutureActions property`() = runTest {
        eventsManager.setLinkToNewFutureActions("https://test.link", delayEvents = false)

        assertEqualsWithContext(
            "https://test.link",
            eventsManager.linkForFutureActions,
            "linkForFutureActions",
            "after setLinkToNewFutureActions('https://test.link', delayEvents=false)"
        )
    }

    @Test
    fun `EventsManager setLinkToNewFutureActions enables backend sending when delayEvents is false`() = runTest {
        eventsManager.setLinkToNewFutureActions("https://test.link", delayEvents = false)

        assertAllowedToSendToBackend(
            eventsManager,
            expected = true,
            context = "after setLinkToNewFutureActions() with delayEvents=false"
        )
    }

    @Test
    fun `EventsManager setLinkToNewFutureActions associates link with existing events`() = runTest {
        val existingEvent = Event(EventType.APP_OPEN, InstantCompat.now())
        coEvery { mockEventsStorage.getEvents() } returns listOf(existingEvent)

        eventsManager.setLinkToNewFutureActions("https://test.link", delayEvents = false)

        coVerify {
            mockEventsStorage.addOrReplaceEvents(match { events ->
                events.any { it.link == "https://test.link" }
            })
        }
    }

    // ==================== Backend Sending Tests ====================

    @Test
    fun `EventsManager does not send events when allowedToSendToBackend is false`() = runTest {
        eventsManager.allowedToSendToBackend = false

        val event = Event(EventType.VIEW, InstantCompat.now())
        eventsManager.log(event)

        coVerify(exactly = 0) { mockSuperBoardService.addEvent(any()) }
    }

    @Test
    fun `EventsManager removes successfully sent events from storage`() = runTest {
        eventsManager.allowedToSendToBackend = true
        eventsManager.firstRequestTime = InstantCompat.now()

        val event = Event(EventType.VIEW, InstantCompat.now())
        coEvery { mockEventsStorage.getEvents() } returns listOf(event)
        coEvery { mockSuperBoardService.addEvent(any()) } returns LSResult.Success(true)

        eventsManager.log(event)

        coVerify { mockEventsStorage.removeEvent(any()) }
    }
}

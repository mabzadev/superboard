package io.opengrow.handlers

import android.content.Context
import com.google.gson.annotations.SerializedName
import io.opengrow.model.DebugLogger
import io.opengrow.model.Event
import io.opengrow.model.EventType
import io.opengrow.model.LogLevel
import io.opengrow.model.events.PaymentEvent
import io.opengrow.model.events.PaymentEventType
import io.opengrow.service.OpenGrowService
import io.opengrow.service.IOpenGrowService
import io.opengrow.storage.EventsStorage
import io.opengrow.storage.IEventsStorage
import io.opengrow.storage.ILocalCache
import io.opengrow.storage.LocalCache
import io.opengrow.utils.AppDetailsHelper
import io.opengrow.utils.DurationCompat
import io.opengrow.utils.InstantCompat
import io.opengrow.utils.LSResult
import io.opengrow.utils.isValidUrl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.time.Duration
import java.time.Instant

class EventsManager(
    val context: Context, 
    val opengrowContext: OpenGrowContext, 
    apiKey: String,
    // Dependencies for testing - if null, real implementations are used
    private val opengrowService: IOpenGrowService = OpenGrowService(context = context, apiKey = apiKey, opengrowContext = opengrowContext),
    private val eventsStorage: IEventsStorage = EventsStorage(context = context),
    private val localCache: ILocalCache = LocalCache(context = context)
) : IEventsManager {
    // Internal state - exposed for testing
    internal var linkForFutureActions: String? = null
    internal var allowedToSendToBackend = false
    internal var firstRequestTime: InstantCompat? = null
    internal var eventsDelaySeconds = 14
    internal var timeSpentScope: CoroutineScope = CoroutineScope(SupervisorJob() + opengrowContext.serialDispatcher)

    private val backgroundTimeSpentLock = Any()
    private var pendingBackgroundTimeSpentJob: Job? = null

    companion object {
        private const val FIRST_BATCH_EVENTS_SENDING_LEEWAY: Long = 15000
        private const val NUMBER_OF_DAYS_FOR_REACTIVATION: Int = 7
    }

    override suspend fun onAppForegrounded() {
        awaitPendingBackgroundTimeSpent()
        sendNormalEventsToBackend()
        sendPaymentEventsToBackend()
        sendTimeSpentEventsToBackend()
        eventsStorage.markTimeSpentNode(startingNode = true, link = linkForFutureActions)
    }

    override fun onAppBackgrounded() {
        localCache.resignTimestamp = InstantCompat.now()
        linkForFutureActions = null

        // Keep a handle to the finalization. A foreground transition must not read or
        // replace the open TIME_SPENT node before the preceding background transition
        // has completed. Chaining also protects against duplicate lifecycle callbacks.
        val job = synchronized(backgroundTimeSpentLock) {
            val previousJob = pendingBackgroundTimeSpentJob
            timeSpentScope.launch(start = CoroutineStart.LAZY) {
                previousJob?.join()
                eventsStorage.markTimeSpentNode(startingNode = false, endingNode = true, link = null)
            }.also { pendingBackgroundTimeSpentJob = it }
        }
        job.start()
    }

    internal suspend fun awaitPendingBackgroundTimeSpent() {
        val job = synchronized(backgroundTimeSpentLock) { pendingBackgroundTimeSpentJob }
        job?.join()

        synchronized(backgroundTimeSpentLock) {
            if (pendingBackgroundTimeSpentJob === job) {
                pendingBackgroundTimeSpentJob = null
            }
        }
    }

    override suspend fun logAppLaunchEvents() {
        addInitialEvents()
        addOpenEvent()
        eventsStorage.markTimeSpentNode(startingNode = true, link = linkForFutureActions)
    }

    /// Logs an event and sends it to the backend.
    /// - Parameter event: The event to log
    override suspend fun log(event: Event) {
        val newEvent = event
        if (newEvent.link == null) {
            newEvent.link = linkForFutureActions
        }

        eventsStorage.addEvent(newEvent)
        sendNormalEventsToBackend()
    }

    /// Logs an in app payment event and sends it to the backend.
    /// - Parameter event: The event to log
    override suspend fun logInAppPurchase(originalJson: String) {
        val events = PaymentEvent.fromOriginalJson(originalJson = originalJson)

        if (events.isEmpty()) {
            DebugLogger.instance.log(LogLevel.ERROR, "The provided originalJson seems to be invalid. Please use the string provided by billing library purchase.originalJson")
        }

        for (event in events) {
            logPurchase(event = event)
        }
    }

    /// Logs an in app payment event and sends it to the backend.
    /// - Parameter event: The event to log
    override suspend fun logCustomPurchase(type: PaymentEventType, priceInCents: Int, currency: String, productId: String, startDate: InstantCompat?) {
        val applicationId = AppDetailsHelper(context).applicationId
        val event = PaymentEvent(eventType = type,
            appId = applicationId,
            priceCents = priceInCents.toLong(),
            currency = currency,
            date = startDate,
            productId = productId,
            store = false
        )

        logPurchase(event = event)
    }

    /// Sets the link for future actions to associate with new events.
    /// - Parameter link: The link to set
    override suspend fun setLinkToNewFutureActions(link: String?, delayEvents: Boolean) {
        linkForFutureActions = link
        allowedToSendToBackend = !delayEvents
        link?.let {
            addLinkToEvents(link)
            eventsStorage.markTimeSpentNode(startingNode = false, link = link)
        } ?: kotlin.run {
            sendNormalEventsToBackend()
            sendPaymentEventsToBackend()
        }
    }

    /// Logs a payment event and sends it to the backend.
    /// - Parameter event: The event to log
    private suspend fun logPurchase(event: PaymentEvent) {
        val newEvent = event
        if (newEvent.link == null) {
            newEvent.link = linkForFutureActions
        }

        eventsStorage.addPaymentEvent(newEvent)
        sendPaymentEventsToBackend()
    }

    /// Adds initial events such as install or reactivation events.
    private suspend fun addInitialEvents() {
        addInstallIfNeeded()
        addReactivationIfNeeded()

        localCache.numberOfOpens += 1
    }

    /// Logs an install event if it's the first app launch.
    private suspend fun addInstallIfNeeded() {
        val numberOfOpens = localCache.numberOfOpens
        if (numberOfOpens == 0) {
            opengrowContext.lastSeen?.let {
                val event = Event(event = EventType.REINSTALL, createdAt = InstantCompat.now(), link = linkForFutureActions)
                eventsStorage.addEvent(event)
            } ?: run {
                val event = Event(event = EventType.INSTALL, createdAt = InstantCompat.now(), link = linkForFutureActions)
                eventsStorage.addEvent(event)
            }
        }
    }

    /// Logs a reactivation event if the app was inactive for the specified number of days.
    private suspend fun addReactivationIfNeeded() {
        val lastResignTimestamp = localCache.lastStartTimestamp
        lastResignTimestamp?.let {
            val duration = DurationCompat.between(it, InstantCompat.now())
            val daysBetween = duration.toDays()

            if (daysBetween >= NUMBER_OF_DAYS_FOR_REACTIVATION) {
                val event = Event(EventType.REACTIVATION, InstantCompat.now(), link = linkForFutureActions)
                eventsStorage.addEvent(event)
            }
        }

        localCache.lastStartTimestamp = InstantCompat.now()
    }

    /// Logs an app open event.
    private suspend fun addOpenEvent() {
        val event = Event(event = EventType.APP_OPEN, createdAt = InstantCompat.now(), link = linkForFutureActions)
        eventsStorage.addEvent(event)
    }

    /// Adds a link to all stored events that do not already have one.
    /// - Parameter link: The link to add
    private suspend fun addLinkToEvents(link: String) {
        // Add a link to the stored events
        changeStorageEvents { oldEvent ->
            val newEvent = oldEvent
            when (newEvent.event) {
                EventType.APP_OPEN, EventType.VIEW, EventType.OPEN, EventType.INSTALL, EventType.REINSTALL, EventType.REACTIVATION -> {
                    if (newEvent.link?.isValidUrl() != true) {
                        newEvent.link = link
                    }
                }
                EventType.TIME_SPENT -> {}
            }
            newEvent
        }

        sendNormalEventsToBackend()
        sendPaymentEventsToBackend()
    }

    /// Changes stored events based on a closure and performs a completion handler.
    /// - Parameter eventHandling: A lambda function that defines how to modify each event
    private suspend fun changeStorageEvents(eventHandling: (oldEvent: Event) -> Event) {
        // Change stored events based on a closure and perform completion
        val events = eventsStorage.getEvents()
        var newEvents = mutableListOf<Event>()

        for (event in events) {
            val newEvent = eventHandling(event)
            newEvents.add(newEvent)
        }

        eventsStorage.addOrReplaceEvents(newEvents)
    }

    /// Sends normal events (non-time-spent, non-payment) to the backend.
    private fun sendNormalEventsToBackend() = runBlocking {
        checkEventsSendingAllowed()
        if (!allowedToSendToBackend) {
            return@runBlocking
        }

        val events = eventsStorage.getEvents()
        DebugLogger.instance.log(LogLevel.INFO, "Sending regular logs to the backend: $events")

        for (event in events) {
            if (event.event != EventType.TIME_SPENT) {
                val result = opengrowService.addEvent(event)
                when (result) {
                    is LSResult.Success -> {
                        eventsStorage.removeEvent(event)
                    }

                    is LSResult.Error -> {
                        DebugLogger.instance.log(LogLevel.INFO, "Failed to send normal: $event error: $result")
                        delay(5000)
                    }
                }
            }
        }
    }

    /// Sends time-spent events to the backend.
    private fun sendTimeSpentEventsToBackend() = runBlocking {
        val events = eventsStorage.getEvents()
        DebugLogger.instance.log(LogLevel.INFO, "Sending time-spent logs to the backend")

        for (event in events) {
            if ((event.event == EventType.TIME_SPENT) && (event.engagementTime != null)) {
                val result = opengrowService.addEvent(event)
                when (result) {
                    is LSResult.Success -> {
                        DebugLogger.instance.log(LogLevel.INFO, "Sent time-spent: $event")
                        eventsStorage.removeEvent(event)
                    }

                    is LSResult.Error -> {
                        DebugLogger.instance.log(LogLevel.INFO, "Failed to send time-spent: $event error: $result")
                        delay(5000)
                    }
                }
            }
        }
    }

    /// Sends payment events to the backend.
    private fun sendPaymentEventsToBackend() = runBlocking {
        checkEventsSendingAllowed()
        if (!allowedToSendToBackend) {
            return@runBlocking
        }

        val events = eventsStorage.getPaymentEvents()
        DebugLogger.instance.log(LogLevel.INFO, "Sending payment logs to the backend: $events")

        for (event in events) {
            val result = opengrowService.addPaymentEvent(event)
            when (result) {
                is LSResult.Success -> {
                    eventsStorage.removePaymentEvent(event)
                }

                is LSResult.Error -> {
                    DebugLogger.instance.log(LogLevel.INFO, "Failed to send payment events: $event error: $result")
                    delay(5000)
                }
            }
        }
    }

    private fun checkEventsSendingAllowed() {
        if (firstRequestTime == null) {
            firstRequestTime = InstantCompat.now()

            GlobalScope.launch {
                delay(FIRST_BATCH_EVENTS_SENDING_LEEWAY)
                sendNormalEventsToBackend()
                sendPaymentEventsToBackend()
            }
        }

        if (!allowedToSendToBackend) {
            // Check if delay was met
            val now = InstantCompat.now()
            val duration = DurationCompat.between(firstRequestTime ?: InstantCompat.now(), now)
            allowedToSendToBackend = duration.seconds > eventsDelaySeconds
        }
    }
}

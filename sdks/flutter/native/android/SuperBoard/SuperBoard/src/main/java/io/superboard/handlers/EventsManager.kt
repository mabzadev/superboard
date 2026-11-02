package io.superboard.handlers

import android.content.Context
import com.google.gson.annotations.SerializedName
import io.superboard.model.DebugLogger
import io.superboard.model.Event
import io.superboard.model.EventType
import io.superboard.model.LogLevel
import io.superboard.model.events.PaymentEvent
import io.superboard.model.events.PaymentEventType
import io.superboard.service.SuperBoardService
import io.superboard.service.ISuperBoardService
import io.superboard.storage.EventsStorage
import io.superboard.storage.IEventsStorage
import io.superboard.storage.ILocalCache
import io.superboard.storage.LocalCache
import io.superboard.utils.AppDetailsHelper
import io.superboard.utils.DurationCompat
import io.superboard.utils.InstantCompat
import io.superboard.utils.LSResult
import io.superboard.utils.isValidUrl
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
    val superboardContext: SuperBoardContext,
    apiKey: String,
    private val superboardService: ISuperBoardService = SuperBoardService(context = context, apiKey = apiKey, superboardContext = superboardContext),
    private val eventsStorage: IEventsStorage = EventsStorage(context = context),
    private val localCache: ILocalCache = LocalCache(context = context)
) : IEventsManager {
    internal var linkForFutureActions: String? = null
    internal var allowedToSendToBackend = false
    internal var firstRequestTime: InstantCompat? = null
    internal var eventsDelaySeconds = 14
    internal var timeSpentScope: CoroutineScope = CoroutineScope(SupervisorJob() + superboardContext.serialDispatcher)

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

    override suspend fun log(event: Event) {
        val newEvent = event
        if (newEvent.link == null) {
            newEvent.link = linkForFutureActions
        }

        eventsStorage.addEvent(newEvent)
        sendNormalEventsToBackend()
    }

    override suspend fun logInAppPurchase(originalJson: String) {
        val events = PaymentEvent.fromOriginalJson(originalJson = originalJson)

        if (events.isEmpty()) {
            DebugLogger.instance.log(LogLevel.ERROR, "The provided originalJson seems to be invalid. Please use the string provided by billing library purchase.originalJson")
        }

        for (event in events) {
            logPurchase(event = event)
        }
    }

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

    private suspend fun logPurchase(event: PaymentEvent) {
        val newEvent = event
        if (newEvent.link == null) {
            newEvent.link = linkForFutureActions
        }

        eventsStorage.addPaymentEvent(newEvent)
        sendPaymentEventsToBackend()
    }

    private suspend fun addInitialEvents() {
        addInstallIfNeeded()
        addReactivationIfNeeded()

        localCache.numberOfOpens += 1
    }

    private suspend fun addInstallIfNeeded() {
        val numberOfOpens = localCache.numberOfOpens
        if (numberOfOpens == 0) {
            superboardContext.lastSeen?.let {
                val event = Event(event = EventType.REINSTALL, createdAt = InstantCompat.now(), link = linkForFutureActions)
                eventsStorage.addEvent(event)
            } ?: run {
                val event = Event(event = EventType.INSTALL, createdAt = InstantCompat.now(), link = linkForFutureActions)
                eventsStorage.addEvent(event)
            }
        }
    }

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

    private suspend fun addOpenEvent() {
        val event = Event(event = EventType.APP_OPEN, createdAt = InstantCompat.now(), link = linkForFutureActions)
        eventsStorage.addEvent(event)
    }

    private suspend fun addLinkToEvents(link: String) {
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

    private suspend fun changeStorageEvents(eventHandling: (oldEvent: Event) -> Event) {
        val events = eventsStorage.getEvents()
        var newEvents = mutableListOf<Event>()

        for (event in events) {
            val newEvent = eventHandling(event)
            newEvents.add(newEvent)
        }

        eventsStorage.addOrReplaceEvents(newEvents)
    }

    private fun sendNormalEventsToBackend() = runBlocking {
        checkEventsSendingAllowed()
        if (!allowedToSendToBackend) {
            return@runBlocking
        }

        val events = eventsStorage.getEvents()
        DebugLogger.instance.log(LogLevel.INFO, "Sending regular logs to the backend: $events")

        for (event in events) {
            if (event.event != EventType.TIME_SPENT) {
                val result = superboardService.addEvent(event)
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

    private fun sendTimeSpentEventsToBackend() = runBlocking {
        val events = eventsStorage.getEvents()
        DebugLogger.instance.log(LogLevel.INFO, "Sending time-spent logs to the backend")

        for (event in events) {
            if ((event.event == EventType.TIME_SPENT) && (event.engagementTime != null)) {
                val result = superboardService.addEvent(event)
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

    private fun sendPaymentEventsToBackend() = runBlocking {
        checkEventsSendingAllowed()
        if (!allowedToSendToBackend) {
            return@runBlocking
        }

        val events = eventsStorage.getPaymentEvents()
        DebugLogger.instance.log(LogLevel.INFO, "Sending payment logs to the backend: $events")

        for (event in events) {
            val result = superboardService.addPaymentEvent(event)
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
            val now = InstantCompat.now()
            val duration = DurationCompat.between(firstRequestTime ?: InstantCompat.now(), now)
            allowedToSendToBackend = duration.seconds > eventsDelaySeconds
        }
    }
}

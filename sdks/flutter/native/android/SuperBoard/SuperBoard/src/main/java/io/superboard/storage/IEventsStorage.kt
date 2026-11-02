package io.superboard.storage

import io.superboard.model.Event
import io.superboard.model.events.PaymentEvent

interface IEventsStorage {
    
    suspend fun addOrReplaceEvents(events: List<Event>)
    
    suspend fun addEvent(event: Event)

    suspend fun addPaymentEvent(event: PaymentEvent)


    suspend fun markTimeSpentNode(startingNode: Boolean, endingNode: Boolean = false, link: String?)
    
    suspend fun removeEvent(event: Event)

    suspend fun removePaymentEvent(event: PaymentEvent)

    suspend fun getEvents(): List<Event>

    suspend fun getPaymentEvents(): List<PaymentEvent>

    suspend fun hasEmptyTimeSpentEvent(): Boolean
}

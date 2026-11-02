package io.superboard.handlers

import io.superboard.model.Event
import io.superboard.model.events.PaymentEventType
import io.superboard.utils.InstantCompat

interface IEventsManager {
    
    suspend fun onAppForegrounded()
    
    fun onAppBackgrounded()
    
    suspend fun logAppLaunchEvents()

    suspend fun logInAppPurchase(originalJson: String)

    suspend fun logCustomPurchase(type: PaymentEventType, priceInCents: Int, currency: String, productId: String, startDate: InstantCompat? = InstantCompat.now())

    suspend fun log(event: Event)
    
    suspend fun setLinkToNewFutureActions(link: String?, delayEvents: Boolean)
}

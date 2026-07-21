package io.opengrow.service

import io.opengrow.model.AppDetails
import io.opengrow.model.AuthenticationResponse
import io.opengrow.model.DeeplinkDetails
import io.opengrow.model.GenerateLinkResponse
import io.opengrow.model.GetDeviceResponse
import io.opengrow.model.LinkDetailsResponse
import io.opengrow.model.Event
import io.opengrow.model.events.PaymentEvent
import io.opengrow.model.notifications.NotificationsResponse
import io.opengrow.model.notifications.NumberOfUnreadNotificationsResponse
import io.opengrow.utils.GVRetryResult
import io.opengrow.utils.LSResult
import kotlinx.coroutines.flow.Flow
import java.io.Serializable

/**
 * Interface for OpenGrow service operations.
 * This allows for dependency injection and easier testing.
 */
interface IOpenGrowService {
    
    /**
     * Authenticate the app with the OpenGrow backend.
     */
    fun authenticate(appDetails: AppDetails): Flow<GVRetryResult<AuthenticationResponse>>
    
    /**
     * Get device information for the given device ID.
     */
    fun getDeviceFor(deviceId: String): Flow<GVRetryResult<GetDeviceResponse>>
    
    /**
     * Get deeplink payload for the app details.
     */
    suspend fun payloadFor(appDetails: AppDetails): LSResult<DeeplinkDetails>
    
    /**
     * Get deeplink payload with specific link.
     */
    suspend fun payloadWithLinkFor(appDetails: AppDetails): LSResult<DeeplinkDetails>
    
    /**
     * Generate a new deep link.
     */
    suspend fun generateLink(
        title: String?,
        subtitle: String?,
        imageURL: String?,
        data: Map<String, Serializable>?,
        tags: List<String>?,
        customRedirects: CustomRedirects?,
        showPreviewIos: Boolean?,
        showPreviewAndroid: Boolean?,
        tracking: TrackingParams?
    ): LSResult<GenerateLinkResponse>
    
    /**
     * Get link details for the given path.
     */
    suspend fun linkDetails(path: String): LSResult<LinkDetailsResponse>
    
    /**
     * Update user attributes.
     */
    suspend fun updateAttributes(
        identifier: String?,
        attributes: Map<String, Any>?,
        pushToken: String?
    ): LSResult<Boolean>
    
    /**
     * Add an event.
     */
    suspend fun addEvent(event: Event): LSResult<Boolean>

    /**
     * Add a payment event.
     */
    suspend fun addPaymentEvent(event: PaymentEvent): LSResult<Boolean>

    /**
     * Get notifications.
     */
    suspend fun notifications(page: Int): LSResult<NotificationsResponse>
    
    /**
     * Get notifications to display automatically.
     */
    suspend fun notificationsToDisplayAutomatically(): LSResult<NotificationsResponse>
    
    /**
     * Get number of unread notifications.
     */
    suspend fun numberOfUnreadNotifications(): LSResult<NumberOfUnreadNotificationsResponse>
    
    /**
     * Mark notification as read.
     */
    suspend fun markNotificationAsRead(notificationId: Int): LSResult<Boolean>
}

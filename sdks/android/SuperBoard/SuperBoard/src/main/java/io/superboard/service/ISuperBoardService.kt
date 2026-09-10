package io.superboard.service

import io.superboard.model.AppDetails
import io.superboard.model.AuthenticationResponse
import io.superboard.model.DeeplinkDetails
import io.superboard.model.GenerateLinkResponse
import io.superboard.model.GetDeviceResponse
import io.superboard.model.LinkDetailsResponse
import io.superboard.model.Event
import io.superboard.model.events.PaymentEvent
import io.superboard.model.notifications.NotificationsResponse
import io.superboard.model.notifications.NumberOfUnreadNotificationsResponse
import io.superboard.utils.GVRetryResult
import io.superboard.utils.LSResult
import kotlinx.coroutines.flow.Flow
import java.io.Serializable

/**
 * Interface for SuperBoard service operations.
 * This allows for dependency injection and easier testing.
 */
interface ISuperBoardService {
    
    /**
     * Authenticate the app with the SuperBoard backend.
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

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

interface ISuperBoardService {
    
    fun authenticate(appDetails: AppDetails): Flow<GVRetryResult<AuthenticationResponse>>
    
    fun getDeviceFor(deviceId: String): Flow<GVRetryResult<GetDeviceResponse>>
    
    suspend fun payloadFor(appDetails: AppDetails): LSResult<DeeplinkDetails>
    
    suspend fun payloadWithLinkFor(appDetails: AppDetails): LSResult<DeeplinkDetails>
    
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
    
    suspend fun linkDetails(path: String): LSResult<LinkDetailsResponse>
    
    suspend fun updateAttributes(
        identifier: String?,
        attributes: Map<String, Any>?,
        pushToken: String?
    ): LSResult<Boolean>
    
    suspend fun addEvent(event: Event): LSResult<Boolean>

    suspend fun addPaymentEvent(event: PaymentEvent): LSResult<Boolean>

    suspend fun notifications(page: Int): LSResult<NotificationsResponse>
    
    suspend fun notificationsToDisplayAutomatically(): LSResult<NotificationsResponse>
    
    suspend fun numberOfUnreadNotifications(): LSResult<NumberOfUnreadNotificationsResponse>
    
    suspend fun markNotificationAsRead(notificationId: Int): LSResult<Boolean>
}

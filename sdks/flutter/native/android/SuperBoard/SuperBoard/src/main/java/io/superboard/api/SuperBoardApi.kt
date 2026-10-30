package io.superboard.api

import android.os.Parcelable
import io.superboard.model.AppDetails
import io.superboard.model.AuthenticationResponse
import io.superboard.model.DeeplinkDetails
import io.superboard.model.Event
import io.superboard.model.GenerateLinkRequest
import io.superboard.model.GenerateLinkResponse
import io.superboard.model.GetDeviceResponse
import io.superboard.model.LinkDetailsRequest
import io.superboard.model.UpdateAttributesRequest
import io.superboard.model.events.PaymentEvent
import io.superboard.model.notifications.MarkNotificationAsReadRequest
import io.superboard.model.notifications.NotificationsRequest
import io.superboard.model.notifications.NotificationsResponse
import io.superboard.model.notifications.NumberOfUnreadNotificationsResponse
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface SuperBoardApi {

    @POST("acquisition/data_for_device")
    suspend fun payloadFor(@Body request: AppDetails): Response<DeeplinkDetails>

    @POST("acquisition/data_for_device_and_url")
    suspend fun payloadWithLinkFor(@Body request: AppDetails): Response<DeeplinkDetails>

    @POST("data/authenticate")
    suspend fun authenticate(@Body request: AppDetails): Response<AuthenticationResponse>

    @POST("acquisition/create_link")
    suspend fun generateLink(@Body request: GenerateLinkRequest): Response<GenerateLinkResponse>

    @POST("acquisition/link_details")
    suspend fun linkDetails(@Body request: LinkDetailsRequest): Response<ResponseBody>

    @POST("data/event")
    suspend fun addEvent(@Body request: Event): Response<Unit>

    @POST("monetization/add_payment_event")
    suspend fun addPaymentEvent(@Body request: PaymentEvent): Response<Unit>

    @POST("data/visitor_attributes")
    suspend fun updateAttributes(@Body request: UpdateAttributesRequest): Response<Unit>

    @GET("data/device_for_vendor_id")
    suspend fun getDeviceFor(@Query("vendor_id") page: String): Response<GetDeviceResponse>

    @POST("communication/notifications_for_device")
    suspend fun notifications(@Body request: NotificationsRequest): Response<NotificationsResponse>

    @GET("communication/number_of_unread_notifications")
    suspend fun numberOfUnreadNotifications(): Response<NumberOfUnreadNotificationsResponse>

    @POST("communication/mark_notification_as_read")
    suspend fun markNotificationAsRead(@Body request: MarkNotificationAsReadRequest): Response<Unit>

    @GET("communication/notifications_to_display_automatically")
    suspend fun notificationsToDisplayAutomatically(): Response<NotificationsResponse>
}

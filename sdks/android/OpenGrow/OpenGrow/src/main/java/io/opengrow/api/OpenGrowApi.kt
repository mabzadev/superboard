package io.opengrow.api

import android.os.Parcelable
import io.opengrow.model.AppDetails
import io.opengrow.model.AuthenticationResponse
import io.opengrow.model.DeeplinkDetails
import io.opengrow.model.Event
import io.opengrow.model.GenerateLinkRequest
import io.opengrow.model.GenerateLinkResponse
import io.opengrow.model.GetDeviceResponse
import io.opengrow.model.LinkDetailsRequest
import io.opengrow.model.UpdateAttributesRequest
import io.opengrow.model.events.PaymentEvent
import io.opengrow.model.notifications.MarkNotificationAsReadRequest
import io.opengrow.model.notifications.NotificationsRequest
import io.opengrow.model.notifications.NotificationsResponse
import io.opengrow.model.notifications.NumberOfUnreadNotificationsResponse
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface OpenGrowApi {

    @POST("data_for_device")
    suspend fun payloadFor(@Body request: AppDetails): Response<DeeplinkDetails>

    @POST("data_for_device_and_url")
    suspend fun payloadWithLinkFor(@Body request: AppDetails): Response<DeeplinkDetails>

    @POST("authenticate")
    suspend fun authenticate(@Body request: AppDetails): Response<AuthenticationResponse>

    @POST("create_link")
    suspend fun generateLink(@Body request: GenerateLinkRequest): Response<GenerateLinkResponse>

    @POST("link_details")
    suspend fun linkDetails(@Body request: LinkDetailsRequest): Response<ResponseBody>

    @POST("event")
    suspend fun addEvent(@Body request: Event): Response<Unit>

    @POST("add_payment_event")
    suspend fun addPaymentEvent(@Body request: PaymentEvent): Response<Unit>

    @POST("visitor_attributes")
    suspend fun updateAttributes(@Body request: UpdateAttributesRequest): Response<Unit>

    @GET("device_for_vendor_id")
    suspend fun getDeviceFor(@Query("vendor_id") page: String): Response<GetDeviceResponse>

    @POST("notifications_for_device")
    suspend fun notifications(@Body request: NotificationsRequest): Response<NotificationsResponse>

    @GET("number_of_unread_notifications")
    suspend fun numberOfUnreadNotifications(): Response<NumberOfUnreadNotificationsResponse>

    @POST("mark_notification_as_read")
    suspend fun markNotificationAsRead(@Body request: MarkNotificationAsReadRequest): Response<Unit>

    @GET("notifications_to_display_automatically")
    suspend fun notificationsToDisplayAutomatically(): Response<NotificationsResponse>
}
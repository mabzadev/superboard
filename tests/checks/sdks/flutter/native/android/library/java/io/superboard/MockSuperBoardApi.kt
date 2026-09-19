package io.superboard

import io.superboard.api.SuperBoardApi
import io.superboard.model.AppDetails
import io.superboard.model.AuthenticationResponse
import io.superboard.model.DeeplinkDetails
import io.superboard.model.GenerateLinkRequest
import io.superboard.model.GenerateLinkResponse
import io.superboard.model.GetDeviceResponse
import io.superboard.model.UpdateAttributesRequest
import io.superboard.model.events.PaymentEvent
import io.superboard.model.notifications.NotificationsRequest
import io.superboard.model.notifications.NotificationsResponse
import io.superboard.model.notifications.NumberOfUnreadNotificationsResponse
import io.superboard.model.notifications.MarkNotificationAsReadRequest
import io.superboard.model.Event
import io.superboard.model.LinkDetailsRequest
import io.superboard.utils.InstantCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.Response

/**
 * Mock implementation of SuperBoardApi for testing purposes.
 * 
 * This mock allows configuring responses for each API endpoint to test
 * different scenarios like success, errors, and edge cases.
 */
class MockSuperBoardApi : SuperBoardApi {

    // =====================================================================
    // Configuration for mock responses
    // =====================================================================
    
    var authenticateResponse: Response<AuthenticationResponse>? = null
    var generateLinkResponse: Response<GenerateLinkResponse>? = null
    var payloadResponse: Response<DeeplinkDetails>? = null
    var payloadWithLinkResponse: Response<DeeplinkDetails>? = null
    var linkDetailsResponse: Response<ResponseBody>? = null
    var getDeviceResponse: Response<GetDeviceResponse>? = null
    var notificationsResponse: Response<NotificationsResponse>? = null
    var numberOfUnreadNotificationsResponse: Response<NumberOfUnreadNotificationsResponse>? = null
    var addEventResponse: Response<Unit>? = null
    var addPaymentEventResponse: Response<Unit>? = null
    var updateAttributesResponse: Response<Unit>? = null
    var markNotificationAsReadResponse: Response<Unit>? = null
    var notificationsToDisplayAutomaticallyResponse: Response<NotificationsResponse>? = null

    // Track method calls for verification
    var authenticateCalls = mutableListOf<AppDetails>()
    var generateLinkCalls = mutableListOf<GenerateLinkRequest>()
    var addEventCalls = mutableListOf<Event>()
    var addPaymentEventCalls = mutableListOf<PaymentEvent>()
    var updateAttributesCalls = mutableListOf<UpdateAttributesRequest>()
    var linkDetailsCalls = mutableListOf<LinkDetailsRequest>()

    // =====================================================================
    // SuperBoardApi Implementation
    // =====================================================================

    override suspend fun payloadFor(request: AppDetails): Response<DeeplinkDetails> {
        return payloadResponse ?: createSuccessDeeplinkResponse()
    }

    override suspend fun payloadWithLinkFor(request: AppDetails): Response<DeeplinkDetails> {
        return payloadWithLinkResponse ?: createSuccessDeeplinkResponse()
    }

    override suspend fun authenticate(request: AppDetails): Response<AuthenticationResponse> {
        authenticateCalls.add(request)
        return authenticateResponse ?: createSuccessAuthResponse()
    }

    override suspend fun generateLink(request: GenerateLinkRequest): Response<GenerateLinkResponse> {
        generateLinkCalls.add(request)
        return generateLinkResponse ?: createSuccessGenerateLinkResponse()
    }

    override suspend fun linkDetails(request: LinkDetailsRequest): Response<ResponseBody> {
        linkDetailsCalls.add(request)
        return linkDetailsResponse ?: createSuccessLinkDetailsResponse()
    }

    override suspend fun addEvent(request: Event): Response<Unit> {
        addEventCalls.add(request)
        return addEventResponse ?: Response.success(Unit)
    }

    override suspend fun addPaymentEvent(request: PaymentEvent): Response<Unit> {
        addPaymentEventCalls.add(request)
        return addPaymentEventResponse ?: Response.success(Unit)
    }

    override suspend fun updateAttributes(request: UpdateAttributesRequest): Response<Unit> {
        updateAttributesCalls.add(request)
        return updateAttributesResponse ?: Response.success(Unit)
    }

    override suspend fun getDeviceFor(page: String): Response<GetDeviceResponse> {
        return getDeviceResponse ?: createSuccessGetDeviceResponse()
    }

    override suspend fun notifications(request: NotificationsRequest): Response<NotificationsResponse> {
        return notificationsResponse ?: createSuccessNotificationsResponse()
    }

    override suspend fun numberOfUnreadNotifications(): Response<NumberOfUnreadNotificationsResponse> {
        return numberOfUnreadNotificationsResponse ?: createSuccessUnreadNotificationsResponse()
    }

    override suspend fun markNotificationAsRead(request: MarkNotificationAsReadRequest): Response<Unit> {
        return markNotificationAsReadResponse ?: Response.success(Unit)
    }

    override suspend fun notificationsToDisplayAutomatically(): Response<NotificationsResponse> {
        return notificationsToDisplayAutomaticallyResponse ?: createSuccessNotificationsResponse()
    }

    // =====================================================================
    // Helper methods to reset and verify
    // =====================================================================

    fun reset() {
        authenticateResponse = null
        generateLinkResponse = null
        payloadResponse = null
        payloadWithLinkResponse = null
        linkDetailsResponse = null
        getDeviceResponse = null
        notificationsResponse = null
        numberOfUnreadNotificationsResponse = null
        addEventResponse = null
        addPaymentEventResponse = null
        updateAttributesResponse = null
        markNotificationAsReadResponse = null
        notificationsToDisplayAutomaticallyResponse = null

        authenticateCalls.clear()
        generateLinkCalls.clear()
        addEventCalls.clear()
        addPaymentEventCalls.clear()
        updateAttributesCalls.clear()
        linkDetailsCalls.clear()
    }

    fun verifyAuthenticateCalled(): Boolean = authenticateCalls.isNotEmpty()
    fun verifyGenerateLinkCalled(): Boolean = generateLinkCalls.isNotEmpty()
    fun verifyAddEventCalled(): Boolean = addEventCalls.isNotEmpty()
    fun verifyAddPaymentEventCalled(): Boolean = addPaymentEventCalls.isNotEmpty()

    // =====================================================================
    // Default success response factories
    // =====================================================================

    companion object {
        private const val TEST_SUPERBOARD_ID = "superboard_id_12345"
        private const val TEST_LINK = "https://example.superboard.io/abc123"

        fun createSuccessAuthResponse(): Response<AuthenticationResponse> {
            return Response.success(AuthenticationResponse(
                superboardId = TEST_SUPERBOARD_ID,
                uriScheme = "superboard",
                sdkIdentifier = null,
                sdkAttributes = null
            ))
        }

        fun createSuccessGenerateLinkResponse(): Response<GenerateLinkResponse> {
            return Response.success(GenerateLinkResponse(link = TEST_LINK))
        }

        fun createSuccessDeeplinkResponse(): Response<DeeplinkDetails> {
            return Response.success(DeeplinkDetails(
                link = TEST_LINK,
                data = null,
                tracking = null
            ))
        }

        fun createSuccessLinkDetailsResponse(): Response<ResponseBody> {
            val json = """{"title": "Test Title", "data": {}}"""
            return Response.success(json.toResponseBody("application/json".toMediaType()))
        }

        fun createSuccessGetDeviceResponse(): Response<GetDeviceResponse> {
            return Response.success(GetDeviceResponse(lastSeen = InstantCompat.now()))
        }

        fun createSuccessNotificationsResponse(): Response<NotificationsResponse> {
            return Response.success(NotificationsResponse(notifications = emptyList()))
        }

        fun createSuccessUnreadNotificationsResponse(): Response<NumberOfUnreadNotificationsResponse> {
            return Response.success(NumberOfUnreadNotificationsResponse(numberOfUnreadNotifications = 0))
        }

        // Error response factories
        fun createErrorResponse(code: Int, message: String): Response<Any> {
            return Response.error(
                code,
                """{"error": "$message"}""".toResponseBody("application/json".toMediaType())
            )
        }

        @Suppress("UNCHECKED_CAST")
        fun <T> createErrorResponseTyped(code: Int, message: String): Response<T> {
            return Response.error(
                code,
                """{"error": "$message"}""".toResponseBody("application/json".toMediaType())
            )
        }
    }
}

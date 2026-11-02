package io.superboard

import io.superboard.model.AppDetails
import io.superboard.model.CustomLinkRedirect
import io.superboard.model.DeeplinkDetails
import io.superboard.model.Event
import io.superboard.model.EventType
import io.superboard.model.GenerateLinkRequest
import io.superboard.utils.InstantCompat

object TestFixtures {

    const val TEST_API_KEY = "test-api-key-123"
    const val TEST_SUPERBOARD_ID = "superboard_123"
    const val TEST_DEVICE_ID = "test-device-id"
    const val TEST_BUNDLE_ID = "io.superboard.test"
    const val TEST_URI_SCHEME = "testscheme"
    const val TEST_LINK = "https://test.link/abc123"

    fun createAppDetails(
        version: String = "1.0.0",
        build: String = "1",
        bundle: String = TEST_BUNDLE_ID,
        device: String = "Test Device",
        deviceID: String = TEST_DEVICE_ID,
        userAgent: String = "Test User Agent",
        screenWidth: String = "1080",
        screenHeight: String = "1920",
        timezone: String = "UTC",
        language: String = "en-US",
        webglVendor: String? = "Test Vendor",
        webglRenderer: String? = "Test Renderer"
    ) = AppDetails(
        version = version,
        build = build,
        bundle = bundle,
        device = device,
        deviceID = deviceID,
        userAgent = userAgent,
        screenWidth = screenWidth,
        screenHeight = screenHeight,
        timezone = timezone,
        language = language,
        webglVendor = webglVendor,
        webglRenderer = webglRenderer
    )

    fun createGenerateLinkRequest(
        title: String? = "Test Title",
        subtitle: String? = null,
        imageUrl: String? = null,
        data: String? = null,
        tags: String? = null,
        iosCustomRedirect: CustomLinkRedirect? = null,
        androidCustomRedirect: CustomLinkRedirect? = null,
        desktopCustomRedirect: CustomLinkRedirect? = null,
        showPreviewIos: Boolean? = null,
        showPreviewAndroid: Boolean? = null,
        trackingCampaign: String? = null,
        trackingMedium: String? = null,
        trackingSource: String? = null
    ) = GenerateLinkRequest(
        title = title,
        subtitle = subtitle,
        imageUrl = imageUrl,
        data = data,
        tags = tags,
        iosCustomRedirect = iosCustomRedirect,
        androidCustomRedirect = androidCustomRedirect,
        desktopCustomRedirect = desktopCustomRedirect,
        showPreviewIos = showPreviewIos,
        showPreviewAndroid = showPreviewAndroid,
        trackingCampaign = trackingCampaign,
        trackingMedium = trackingMedium,
        trackingSource = trackingSource
    )

    fun createEvent(
        event: EventType = EventType.VIEW,
        createdAt: InstantCompat = InstantCompat.now(),
        link: String? = null,
        engagementTime: Int? = null
    ) = Event(
        event = event,
        createdAt = createdAt,
        link = link,
        engagementTime = engagementTime
    )

    fun createDeeplinkDetails(
        link: String? = TEST_LINK,
        data: Map<String, Object>? = null,
        tracking: Map<String, Object>? = null
    ) = DeeplinkDetails(
        link = link,
        data = data,
        tracking = tracking
    )
}

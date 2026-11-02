package io.superboard.model.notifications

import android.os.Parcelable
import com.google.gson.annotations.SerializedName
import io.superboard.utils.InstantCompat
import kotlinx.parcelize.Parcelize
import java.time.Instant

@Parcelize
data class NotificationsRequest (
    var page: Int
) : Parcelable {
}

@Parcelize
data class NotificationsResponse (
    val notifications: List<Notification>?
) : Parcelable {
}

@Parcelize
data class Notification(
    val id: Int,
    val title: String,
    @SerializedName("updated_at")
    val updatedAt: InstantCompat,
    val subtitle: String?,
    @SerializedName("auto_display")
    val autoDisplay: Boolean,
    @SerializedName("access_url")
    val accessURL: String?,
    var read: Boolean
) : Parcelable

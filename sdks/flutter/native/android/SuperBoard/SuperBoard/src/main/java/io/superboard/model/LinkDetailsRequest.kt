package io.superboard.model

import android.os.Parcelable
import com.google.gson.annotations.SerializedName
import io.superboard.utils.InstantCompat
import kotlinx.parcelize.Parcelize

@Parcelize
class LinkDetailsRequest(
    val path: String
) : Parcelable {
}

class LinkDetailsResponse(
    val link:  Map<String, Any>
) {
}
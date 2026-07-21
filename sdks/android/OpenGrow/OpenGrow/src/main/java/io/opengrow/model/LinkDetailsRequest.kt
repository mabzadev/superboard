package io.opengrow.model

import android.os.Parcelable
import com.google.gson.annotations.SerializedName
import io.opengrow.utils.InstantCompat
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
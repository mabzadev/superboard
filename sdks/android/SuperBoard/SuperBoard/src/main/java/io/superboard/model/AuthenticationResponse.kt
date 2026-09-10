package io.superboard.model

import android.os.Parcelable
import com.google.gson.annotations.SerializedName
import kotlinx.parcelize.Parcelize

class AuthenticationResponse(
    @SerializedName("linksquared")
    val superboardId: String,
    @SerializedName("uri_scheme")
    val uriScheme: String,
    @SerializedName("sdk_identifier")
    val sdkIdentifier: String?,
    @SerializedName("sdk_attributes")
    val sdkAttributes: Map<String, Object>?
)  {
}
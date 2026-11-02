package io.superboard.utils

import io.superboard.model.AppDetails

interface IAppDetailsHelper {
    val versionName: String
    val versionCode: Int
    val applicationId: String
    val deviceID: String
    val device: String
    
    suspend fun toAppDetails(): AppDetails
}

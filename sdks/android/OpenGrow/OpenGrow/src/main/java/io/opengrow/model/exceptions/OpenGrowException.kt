package io.opengrow.model.exceptions

import java.io.PrintWriter
import java.io.StringWriter

fun Throwable.getStackTraceAsString(): String {
    val stringWriter = StringWriter()
    val printWriter = PrintWriter(stringWriter)
    this.printStackTrace(printWriter)
    return stringWriter.toString()
}

enum class OpenGrowErrorCode {
    LINK_GENERATION_ERROR, SDK_NOT_INITIALIZED, NOTIFICATIONS_ERROR, LINK_DETAILS_ERROR
}

class OpenGrowException(message: String?) : Exception(message) {
    var errorCode: OpenGrowErrorCode? = null

    constructor(message: String?, errorCode: OpenGrowErrorCode) : this(message) {
        this.errorCode = errorCode
    }

    override fun toString(): String {
        return "OpenGrowException(errorCode=$errorCode, message=${super.message})"
    }
}
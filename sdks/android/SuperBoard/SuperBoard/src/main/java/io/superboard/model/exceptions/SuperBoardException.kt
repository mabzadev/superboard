package io.superboard.model.exceptions

import java.io.PrintWriter
import java.io.StringWriter

fun Throwable.getStackTraceAsString(): String {
    val stringWriter = StringWriter()
    val printWriter = PrintWriter(stringWriter)
    this.printStackTrace(printWriter)
    return stringWriter.toString()
}

enum class SuperBoardErrorCode {
    LINK_GENERATION_ERROR, SDK_NOT_INITIALIZED, NOTIFICATIONS_ERROR, LINK_DETAILS_ERROR
}

class SuperBoardException(message: String?) : Exception(message) {
    var errorCode: SuperBoardErrorCode? = null

    constructor(message: String?, errorCode: SuperBoardErrorCode) : this(message) {
        this.errorCode = errorCode
    }

    override fun toString(): String {
        return "SuperBoardException(errorCode=$errorCode, message=${super.message})"
    }
}
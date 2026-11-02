package io.superboard.service

import com.google.gson.Gson
import io.superboard.model.DebugLogger
import io.superboard.model.ErrorMessage
import io.superboard.model.LogLevel
import io.superboard.utils.GVRetryResult
import io.superboard.utils.LSResult
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import retrofit2.Response
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlin.random.Random

internal object SuperBoardRetryPolicy {
    const val MAX_RETRY_ATTEMPTS = 5
    const val BASE_DELAY_MILLIS = 2_000L
    const val MAX_DELAY_MILLIS = 60_000L
    const val JITTER_MILLIS = 1_000L

    private const val MAX_BACKOFF_SHIFT = 16
    private const val HTTP_REQUEST_TIMEOUT = 408
    private const val HTTP_TOO_MANY_REQUESTS = 429
    private const val HTTP_SERVER_ERROR_MIN = 500
    private const val HTTP_SERVER_ERROR_MAX = 599

    fun isRetryableStatus(code: Int): Boolean =
        code == HTTP_REQUEST_TIMEOUT ||
            code == HTTP_TOO_MANY_REQUESTS ||
            code in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX

    fun delayMillis(retryCount: Int, random: Random = Random.Default): Long {
        val shift = retryCount.coerceIn(0, MAX_BACKOFF_SHIFT)
        val base = (BASE_DELAY_MILLIS shl shift).coerceAtMost(MAX_DELAY_MILLIS)
        return base + random.nextLong(JITTER_MILLIS + 1)
    }
}

internal class SuperBoardRequestExecutor(private val gson: Gson) {
    private sealed class Outcome<out T : Any> {
        class Success<out T : Any>(val value: T) : Outcome<T>()
        class Failure(val error: Exception, val retryable: Boolean) : Outcome<Nothing>()
    }

    suspend fun <B : Any, T : Any> request(
        label: String,
        failureMessage: String,
        call: suspend () -> Response<B>,
        onSuccess: (B?) -> T?,
    ): LSResult<T> {
        var retryCount = 0
        var outcome = attempt(label, failureMessage, call, onSuccess)
        while (shouldRetry(outcome, retryCount)) {
            delay(SuperBoardRetryPolicy.delayMillis(retryCount))
            retryCount++
            outcome = attempt(label, failureMessage, call, onSuccess)
        }

        return when (outcome) {
            is Outcome.Success -> LSResult.Success(outcome.value)
            is Outcome.Failure -> LSResult.Error(outcome.error)
        }
    }

    fun <B : Any, T : Any> retryingFlow(
        label: String,
        failureMessage: String,
        call: suspend () -> Response<B>,
        onSuccess: (B?) -> T?,
    ): Flow<GVRetryResult<T>> = flow {
        var retryCount = 0
        var outcome = attempt(label, failureMessage, call, onSuccess)
        while (shouldRetry(outcome, retryCount)) {
            emit(GVRetryResult.Retrying(retryCount))
            delay(SuperBoardRetryPolicy.delayMillis(retryCount))
            retryCount++
            outcome = attempt(label, failureMessage, call, onSuccess)
        }

        when (outcome) {
            is Outcome.Success -> emit(GVRetryResult.Success(outcome.value))
            is Outcome.Failure -> emit(GVRetryResult.Error(outcome.error))
        }
    }

    private fun shouldRetry(outcome: Outcome<*>, retryCount: Int): Boolean =
        outcome is Outcome.Failure && outcome.retryable && retryCount < SuperBoardRetryPolicy.MAX_RETRY_ATTEMPTS

    private suspend fun <B : Any, T : Any> attempt(
        label: String,
        failureMessage: String,
        call: suspend () -> Response<B>,
        onSuccess: (B?) -> T?,
    ): Outcome<T> = runCatching { call() }.fold(
        onSuccess = { response -> classify(label, failureMessage, response, onSuccess) },
        onFailure = { cause -> classifyException(label, cause) },
    )

    private fun <B : Any, T : Any> classify(
        label: String,
        failureMessage: String,
        response: Response<B>,
        onSuccess: (B?) -> T?,
    ): Outcome<T> {
        val value = if (response.isSuccessful) onSuccess(response.body()) else null
        return when {
            value != null -> Outcome.Success(value)
            response.isSuccessful -> failure(label, failureMessage, "Empty response body.", retryable = false)
            else -> failure(
                label,
                failureMessage,
                errorReason(response),
                retryable = SuperBoardRetryPolicy.isRetryableStatus(response.code()),
            )
        }
    }

    private fun classifyException(label: String, cause: Throwable): Outcome<Nothing> {
        if (cause is CancellationException || cause !is Exception) throw cause
        DebugLogger.instance.log(LogLevel.INFO, "$label - Failed. Exception: ${cause.message}")
        return Outcome.Failure(cause, retryable = cause is IOException)
    }

    private fun failure(label: String, failureMessage: String, reason: String, retryable: Boolean): Outcome<Nothing> {
        DebugLogger.instance.log(LogLevel.INFO, "$label - Failed. $reason")
        return Outcome.Failure(IOException("$failureMessage $reason"), retryable)
    }

    private fun errorReason(response: Response<*>): String {
        val message = runCatching {
            response.errorBody()?.string()?.let { gson.fromJson(it, ErrorMessage::class.java)?.error }
        }.getOrNull()
        return message?.takeIf { it.isNotBlank() } ?: "HTTP ${response.code()}"
    }
}

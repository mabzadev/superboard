package io.superboard.service

import com.google.gson.Gson
import io.superboard.e2e.E2ETestUtils
import io.superboard.handlers.SuperBoardContext
import io.superboard.model.notifications.NumberOfUnreadNotificationsResponse
import io.superboard.utils.GVRetryResult
import io.superboard.utils.LSResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import retrofit2.Response
import java.io.IOException
import kotlin.random.Random

/**
 * Exercises the production retry policy used by [SuperBoardService]: bounded attempts,
 * exponential backoff with jitter, final failures on non-retryable statuses and on empty
 * 2xx bodies, and no swallowing of non-network exceptions.
 */
@ExperimentalCoroutinesApi
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class SuperBoardServiceRetryTest {

    private val executor = SuperBoardRequestExecutor(Gson())
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun <T> error(code: Int): Response<T> =
        Response.error(code, """{"error": "status $code"}""".toResponseBody("application/json".toMediaType()))

    /** Returns the scripted responses in order and counts the attempts. */
    private class Script<T>(vararg steps: () -> Response<T>) {
        private val remaining = ArrayDeque(steps.toList())
        var calls = 0
            private set

        fun next(): Response<T> {
            calls++
            return remaining.removeFirst().invoke()
        }
    }

    private suspend fun <T : Any> run(script: Script<T>): LSResult<T> =
        executor.request("Test", "Failed.", { script.next() }) { it }

    @Test
    fun `retryable statuses and network errors are retried until success`() = runTest {
        val script = Script(
            { error(503) },
            { throw IOException("offline") },
            { error(429) },
            { error(408) },
            { Response.success("ok") },
        )

        assertEquals(LSResult.Success("ok"), run(script))
        assertEquals(5, script.calls)
        assertTrue(
            "backoff waits between attempts",
            currentTime >= SuperBoardRetryPolicy.BASE_DELAY_MILLIS * (1 + 2 + 4 + 8),
        )
    }

    @Test
    fun `persistent failures stop after the bounded number of retries`() = runTest {
        val attempts = SuperBoardRetryPolicy.MAX_RETRY_ATTEMPTS + 1
        val script = Script<String>(*Array(attempts + 3) { { error<String>(500) } })

        val result = run(script)

        assertTrue(result is LSResult.Error)
        assertEquals(attempts, script.calls)
    }

    @Test
    fun `non retryable client errors fail immediately with the server message`() = runTest {
        val script = Script<String>({ error(404) }, { Response.success("unexpected") })

        val result = run(script)

        assertTrue((result as LSResult.Error).exception.message!!.contains("status 404"))
        assertEquals(1, script.calls)
    }

    @Test
    fun `non network exceptions are final`() = runTest {
        val script = Script<String>({ throw IllegalStateException("malformed") }, { Response.success("ok") })

        val result = run(script)

        assertTrue((result as LSResult.Error).exception is IllegalStateException)
        assertEquals(1, script.calls)
    }

    @Test
    fun `empty 2xx body is a final error unless the endpoint has no body`() = runTest {
        val empty = Script<String>({ Response.success(null) }, { Response.success("late") })
        assertTrue(run(empty) is LSResult.Error)
        assertEquals(1, empty.calls)

        val noBody = Script<Unit>({ Response.success(null) })
        assertEquals(LSResult.Success(true), executor.request("Test", "Failed.", { noBody.next() }) { true })
    }

    @Test
    fun `retrying flow reports each retry then the final result`() = runTest {
        val script = Script({ throw IOException("offline") }, { error(502) }, { Response.success("ok") })

        val results = executor.retryingFlow("Test", "Failed.", { script.next() }) { it }.toList()

        assertEquals(
            listOf(GVRetryResult.Retrying(0), GVRetryResult.Retrying(1), GVRetryResult.Success("ok")),
            results,
        )
    }

    @Test
    fun `retrying flow emits a single error on non retryable status`() = runTest {
        val script = Script<String>({ error(401) })

        val results = executor.retryingFlow("Test", "Failed.", { script.next() }) { it }.toList()

        assertEquals(1, results.size)
        assertTrue(results[0] is GVRetryResult.Error)
    }

    @Test
    fun `retry delay grows exponentially with bounded jitter`() {
        val random = Random(42)
        for (retry in 0..40) {
            val base = minOf(
                SuperBoardRetryPolicy.BASE_DELAY_MILLIS shl minOf(retry, 16),
                SuperBoardRetryPolicy.MAX_DELAY_MILLIS,
            )
            val delay = SuperBoardRetryPolicy.delayMillis(retry, random)
            assertTrue("retry $retry delay $delay", delay in base..(base + SuperBoardRetryPolicy.JITTER_MILLIS))
        }
        listOf(408, 429, 500, 503, 599).forEach { assertTrue("$it", SuperBoardRetryPolicy.isRetryableStatus(it)) }
        listOf(200, 400, 401, 403, 404, 422).forEach { assertFalse("$it", SuperBoardRetryPolicy.isRetryableStatus(it)) }
    }

    @Test
    fun `service retries server errors and accepts empty bodies over HTTP`() {
        val context = SuperBoardContext()
        context.settings.baseURL = server.url("/").toString()
        val service = SuperBoardService(RuntimeEnvironment.getApplication(), "test-api-key", context)
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error": "busy"}"""))
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"number_of_unread_notifications": 3}"""))
        // markNotificationAsRead answers 2xx without a body; this used to loop forever.
        server.enqueue(MockResponse().setResponseCode(200))
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error": "bad request"}"""))
        server.enqueue(MockResponse().setResponseCode(200))

        // The user agent header needs the main looper, so pump it while the requests run
        // (with a real, single backoff delay).
        val results = E2ETestUtils.runWithLooperPumping(timeoutMs = 20_000, failOnTimeout = true) {
            listOf(
                service.numberOfUnreadNotifications(),
                service.markNotificationAsRead(7),
                service.updateAttributes("user", null, null),
            )
        }!!

        assertEquals(LSResult.Success(NumberOfUnreadNotificationsResponse(3)), results[0])
        assertEquals(LSResult.Success(true), results[1])
        assertTrue((results[2] as LSResult.Error).exception.message!!.contains("bad request"))
        assertEquals(4, server.requestCount)
    }
}

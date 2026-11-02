package io.superboard

import io.mockk.*
import org.junit.Assert.*

object TestAssertions {

    fun <T> assertEqualsWithContext(expected: T, actual: T, valueName: String, context: String) {
        assertEquals(
            "Expected $valueName to be '$expected' $context, but was '$actual'",
            expected,
            actual
        )
    }

    fun assertNullWithContext(actual: Any?, valueName: String, context: String) {
        assertNull(
            "Expected $valueName to be null $context, but was '$actual'",
            actual
        )
    }

    fun assertNotNullWithContext(actual: Any?, valueName: String, context: String) {
        assertNotNull(
            "Expected $valueName to be non-null $context, but was null",
            actual
        )
    }

    fun assertTrueWithContext(condition: Boolean, conditionName: String, context: String) {
        assertTrue(
            "Expected '$conditionName' to be true $context, but was false",
            condition
        )
    }

    fun assertFalseWithContext(condition: Boolean, conditionName: String, context: String) {
        assertFalse(
            "Expected '$conditionName' to be false $context, but was true",
            condition
        )
    }

    fun assertAuthenticated(manager: io.superboard.handlers.SuperBoardManager, context: String) {
        val actual = manager.authenticationState
        assertEquals(
            "Expected authenticationState to be AUTHENTICATED $context, but was $actual",
            io.superboard.handlers.SuperBoardManager.AuthenticationState.AUTHENTICATED,
            actual
        )
    }

    fun assertUnauthenticated(manager: io.superboard.handlers.SuperBoardManager, context: String) {
        val actual = manager.authenticationState
        assertEquals(
            "Expected authenticationState to be UNAUTHENTICATED $context, but was $actual",
            io.superboard.handlers.SuperBoardManager.AuthenticationState.UNAUTHENTICATED,
            actual
        )
    }

    fun assertSdkEnabled(superboardContext: io.superboard.handlers.SuperBoardContext, context: String) {
        assertTrue(
            "Expected SDK to be enabled $context, but sdkEnabled was false",
            superboardContext.settings.sdkEnabled
        )
    }

    fun assertSdkDisabled(superboardContext: io.superboard.handlers.SuperBoardContext, context: String) {
        assertFalse(
            "Expected SDK to be disabled $context, but sdkEnabled was true",
            superboardContext.settings.sdkEnabled
        )
    }

    fun assertAllowedToSendToBackend(
        eventsManager: io.superboard.handlers.EventsManager,
        expected: Boolean,
        context: String
    ) {
        val actual = eventsManager.allowedToSendToBackend
        assertEquals(
            "Expected allowedToSendToBackend to be $expected $context, but was $actual",
            expected,
            actual
        )
    }

    fun assertCallbackInvokedWithLink(
        link: String?,
        error: Exception?,
        expectedLink: String,
        context: String
    ) {
        assertNull(
            "Expected no error in callback $context, but got: ${error?.message}",
            error
        )
        assertNotNull(
            "Expected link in callback $context, but was null",
            link
        )
        assertEquals(
            "Expected callback link to be '$expectedLink' $context, but was '$link'",
            expectedLink,
            link
        )
    }

    fun assertCallbackInvokedWithError(
        error: Exception?,
        expectedMessageContains: String,
        context: String
    ) {
        assertNotNull(
            "Expected error in callback $context, but error was null",
            error
        )
        assertTrue(
            "Expected error message to contain '$expectedMessageContains' $context, but was: ${error?.message}",
            error?.message?.contains(expectedMessageContains) == true
        )
    }

    fun assertLatchCompleted(
        latch: java.util.concurrent.CountDownLatch,
        timeoutMs: Long,
        context: String
    ) {
        val completed = latch.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        assertTrue(
            "Expected latch to complete within ${timeoutMs}ms $context, but it timed out (count was ${latch.count})",
            completed
        )
    }

    fun assertCallbackInvoked(invoked: Boolean, timeoutMs: Long, context: String) {
        assertTrue(
            "Expected callback to be invoked within ${timeoutMs}ms $context, but it was not",
            invoked
        )
    }

    suspend fun assertEventSent(
        eventType: io.superboard.model.EventType,
        mockService: io.superboard.service.ISuperBoardService,
        context: String
    ) {
        try {
            coVerify { mockService.addEvent(match { it.event == eventType }) }
        } catch (e: AssertionError) {
            throw AssertionError(
                "Expected $eventType event to be sent to backend $context, but it was not. Original: ${e.message}"
            )
        }
    }

    suspend fun assertEventStored(
        eventType: io.superboard.model.EventType,
        mockStorage: io.superboard.storage.IEventsStorage,
        context: String
    ) {
        try {
            coVerify { mockStorage.addEvent(match { it.event == eventType }) }
        } catch (e: AssertionError) {
            throw AssertionError(
                "Expected $eventType event to be stored $context, but it was not. Original: ${e.message}"
            )
        }
    }

    suspend fun assertNoEventsSent(
        mockService: io.superboard.service.ISuperBoardService,
        context: String
    ) {
        try {
            coVerify(exactly = 0) { mockService.addEvent(any()) }
        } catch (e: AssertionError) {
            throw AssertionError(
                "Expected no events to be sent to backend $context, but some were sent. Original: ${e.message}"
            )
        }
    }

    suspend fun assertEventRemoved(
        mockStorage: io.superboard.storage.IEventsStorage,
        context: String
    ) {
        try {
            coVerify { mockStorage.removeEvent(any()) }
        } catch (e: AssertionError) {
            throw AssertionError(
                "Expected event to be removed from storage $context, but it was not. Original: ${e.message}"
            )
        }
    }

    fun <T : Any> assertResultSuccess(result: io.superboard.utils.LSResult<T>, context: String): T {
        assertTrue(
            "Expected LSResult.Success $context, but was LSResult.Error: ${(result as? io.superboard.utils.LSResult.Error)?.exception?.message}",
            result is io.superboard.utils.LSResult.Success
        )
        return (result as io.superboard.utils.LSResult.Success).data
    }

    fun <T : Any> assertResultError(result: io.superboard.utils.LSResult<T>, context: String): Exception {
        assertTrue(
            "Expected LSResult.Error $context, but was LSResult.Success",
            result is io.superboard.utils.LSResult.Error
        )
        return (result as io.superboard.utils.LSResult.Error).exception
    }

    fun <T : Any> assertResultErrorContains(
        result: io.superboard.utils.LSResult<T>,
        expectedMessageContains: String,
        context: String
    ) {
        val error = assertResultError(result, context)
        assertTrue(
            "Expected error message to contain '$expectedMessageContains' $context, but was: ${error.message}",
            error.message?.contains(expectedMessageContains) == true
        )
    }
}

package io.superboard

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import io.superboard.TestAssertions.assertEqualsWithContext
import io.superboard.TestAssertions.assertNotNullWithContext
import io.superboard.TestAssertions.assertTrueWithContext
import io.superboard.TestAssertions.assertFalseWithContext
import io.superboard.handlers.SuperBoardContext
import io.superboard.settings.SuperBoardSettings
import io.superboard.storage.LocalCache
import io.superboard.utils.InstantCompat
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Core tests for storage classes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class StorageTest {

    private lateinit var context: Context
    private lateinit var localCache: LocalCache

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.getSharedPreferences("superboard_storage", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
        localCache = LocalCache(context)
    }

    @Test
    fun `LocalCache numberOfOpens persists across new LocalCache instances`() {
        localCache.numberOfOpens = 5

        assertEqualsWithContext(
            5,
            localCache.numberOfOpens,
            "numberOfOpens",
            "after setting to 5"
        )

        val newCache = LocalCache(context)
        assertEqualsWithContext(
            5,
            newCache.numberOfOpens,
            "numberOfOpens",
            "after creating new LocalCache instance (verifying persistence)"
        )
    }

    @Test
    fun `LocalCache resignTimestamp and lastStartTimestamp persist across new LocalCache instances`() {
        val timestamp = InstantCompat.ofEpochMilli(1702656000000L)

        localCache.resignTimestamp = timestamp
        localCache.lastStartTimestamp = timestamp

        val newCache = LocalCache(context)
        assertEqualsWithContext(
            timestamp.epochMillis,
            newCache.resignTimestamp!!.epochMillis,
            "resignTimestamp.epochMillis",
            "after creating new LocalCache instance (verifying persistence)"
        )
        assertEqualsWithContext(
            timestamp.epochMillis,
            newCache.lastStartTimestamp!!.epochMillis,
            "lastStartTimestamp.epochMillis",
            "after creating new LocalCache instance (verifying persistence)"
        )
    }

    @Test
    fun `SuperBoardSettings has debugLevel ERROR, useTestEnvironment false, sdkEnabled true by default`() {
        val settings = SuperBoardSettings()

        assertEqualsWithContext(
            io.superboard.model.LogLevel.ERROR,
            settings.debugLevel,
            "debugLevel",
            "when SuperBoardSettings newly constructed"
        )
        assertFalseWithContext(
            settings.useTestEnvironment,
            "useTestEnvironment",
            "when SuperBoardSettings newly constructed"
        )
        assertTrueWithContext(
            settings.sdkEnabled,
            "sdkEnabled",
            "when SuperBoardSettings newly constructed"
        )
    }

    @Test
    fun `SuperBoardContext stores superboardId, identifier, pushToken, attributes, and lastSeen properties`() {
        val superboardContext = SuperBoardContext()

        superboardContext.superboardId = "superboard-id"
        superboardContext.identifier = "user-id"
        superboardContext.pushToken = "token"
        superboardContext.attributes = mapOf("key" to "value")
        superboardContext.lastSeen = InstantCompat.now()

        assertEqualsWithContext(
            "superboard-id",
            superboardContext.superboardId,
            "superboardId",
            "after setting all properties"
        )
        assertEqualsWithContext(
            "user-id",
            superboardContext.identifier,
            "identifier",
            "after setting all properties"
        )
        assertEqualsWithContext(
            "token",
            superboardContext.pushToken,
            "pushToken",
            "after setting all properties"
        )
        assertEqualsWithContext(
            mapOf("key" to "value"),
            superboardContext.attributes,
            "attributes",
            "after setting all properties"
        )
        assertNotNullWithContext(
            superboardContext.lastSeen,
            "lastSeen",
            "after setting all properties"
        )
        assertNotNullWithContext(
            superboardContext.settings,
            "settings",
            "after construction (default settings)"
        )
    }

    @Test
    fun `SuperBoardContext getAppDetails returns non-null and getUserAgent returns non-empty string`() {
        val superboardContext = SuperBoardContext()

        assertNotNullWithContext(
            superboardContext.getAppDetails(context),
            "getAppDetails result",
            "when called with valid context"
        )
        assertTrueWithContext(
            superboardContext.getUserAgent(context).isNotEmpty(),
            "getUserAgent().isNotEmpty()",
            "when called with valid context"
        )
    }
}

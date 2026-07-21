package io.opengrow

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import io.opengrow.TestAssertions.assertEqualsWithContext
import io.opengrow.TestAssertions.assertNotNullWithContext
import io.opengrow.TestAssertions.assertTrueWithContext
import io.opengrow.TestAssertions.assertFalseWithContext
import io.opengrow.handlers.OpenGrowContext
import io.opengrow.settings.OpenGrowSettings
import io.opengrow.storage.LocalCache
import io.opengrow.utils.InstantCompat
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
        context.getSharedPreferences("opengrow_storage", Context.MODE_PRIVATE)
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
    fun `OpenGrowSettings has debugLevel ERROR, useTestEnvironment false, sdkEnabled true by default`() {
        val settings = OpenGrowSettings()

        assertEqualsWithContext(
            io.opengrow.model.LogLevel.ERROR,
            settings.debugLevel,
            "debugLevel",
            "when OpenGrowSettings newly constructed"
        )
        assertFalseWithContext(
            settings.useTestEnvironment,
            "useTestEnvironment",
            "when OpenGrowSettings newly constructed"
        )
        assertTrueWithContext(
            settings.sdkEnabled,
            "sdkEnabled",
            "when OpenGrowSettings newly constructed"
        )
    }

    @Test
    fun `OpenGrowContext stores opengrowId, identifier, pushToken, attributes, and lastSeen properties`() {
        val opengrowContext = OpenGrowContext()

        opengrowContext.opengrowId = "opengrow-id"
        opengrowContext.identifier = "user-id"
        opengrowContext.pushToken = "token"
        opengrowContext.attributes = mapOf("key" to "value")
        opengrowContext.lastSeen = InstantCompat.now()

        assertEqualsWithContext(
            "opengrow-id",
            opengrowContext.opengrowId,
            "opengrowId",
            "after setting all properties"
        )
        assertEqualsWithContext(
            "user-id",
            opengrowContext.identifier,
            "identifier",
            "after setting all properties"
        )
        assertEqualsWithContext(
            "token",
            opengrowContext.pushToken,
            "pushToken",
            "after setting all properties"
        )
        assertEqualsWithContext(
            mapOf("key" to "value"),
            opengrowContext.attributes,
            "attributes",
            "after setting all properties"
        )
        assertNotNullWithContext(
            opengrowContext.lastSeen,
            "lastSeen",
            "after setting all properties"
        )
        assertNotNullWithContext(
            opengrowContext.settings,
            "settings",
            "after construction (default settings)"
        )
    }

    @Test
    fun `OpenGrowContext getAppDetails returns non-null and getUserAgent returns non-empty string`() {
        val opengrowContext = OpenGrowContext()

        assertNotNullWithContext(
            opengrowContext.getAppDetails(context),
            "getAppDetails result",
            "when called with valid context"
        )
        assertTrueWithContext(
            opengrowContext.getUserAgent(context).isNotEmpty(),
            "getUserAgent().isNotEmpty()",
            "when called with valid context"
        )
    }
}

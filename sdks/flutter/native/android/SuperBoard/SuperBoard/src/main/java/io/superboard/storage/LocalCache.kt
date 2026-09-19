package io.superboard.storage

import android.content.Context
import io.superboard.utils.InstantCompat
import java.time.Instant

class LocalCache(val context: Context) : ILocalCache {
    private val preferences = context.getSharedPreferences(EventsStorage.SUPERBOARD_STORAGE, Context.MODE_PRIVATE)

    companion object {
        private const val SUPERBOARD_NUMBER_OF_OPENS = "superboard_number_of_opens"
        private const val SUPERBOARD_RESIGN_TIMESTAMP = "superboard_resign_timestamp"
        private const val SUPERBOARD_LAST_START_TIMESTAMP = "superboard_last_start_timestamp"
    }

    override var numberOfOpens:Int
        set(value) {
            val editor = preferences.edit()
            editor.putInt(SUPERBOARD_NUMBER_OF_OPENS, value)
            editor.apply()
        }
        get() {
            return preferences.getInt(SUPERBOARD_NUMBER_OF_OPENS, 0)
        }

    override var resignTimestamp:InstantCompat?
        set(value) {
            val editor = preferences.edit()
            editor.putString(SUPERBOARD_RESIGN_TIMESTAMP, value.toString())
            editor.apply()
        }
        get() {
            val string = preferences.getString(SUPERBOARD_RESIGN_TIMESTAMP, null)
            string?.let {
                val instant = InstantCompat.parse(it)
                return instant
            } ?: run {
                return null
            }
        }

    override var lastStartTimestamp:InstantCompat?
        set(value) {
            val editor = preferences.edit()
            editor.putString(SUPERBOARD_LAST_START_TIMESTAMP, value.toString())
            editor.apply()
        }
        get() {
            val string = preferences.getString(SUPERBOARD_LAST_START_TIMESTAMP, null)
            string?.let {
                val instant = InstantCompat.parse(it)
                return instant
            } ?: run {
                return null
            }
        }

}
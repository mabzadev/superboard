package io.opengrow.storage

import android.content.Context
import io.opengrow.utils.InstantCompat
import java.time.Instant

class LocalCache(val context: Context) : ILocalCache {
    private val preferences = context.getSharedPreferences(EventsStorage.OPENGROW_STORAGE, Context.MODE_PRIVATE)

    companion object {
        private const val OPENGROW_NUMBER_OF_OPENS = "opengrow_number_of_opens"
        private const val OPENGROW_RESIGN_TIMESTAMP = "opengrow_resign_timestamp"
        private const val OPENGROW_LAST_START_TIMESTAMP = "opengrow_last_start_timestamp"
    }

    override var numberOfOpens:Int
        set(value) {
            val editor = preferences.edit()
            editor.putInt(OPENGROW_NUMBER_OF_OPENS, value)
            editor.apply()
        }
        get() {
            return preferences.getInt(OPENGROW_NUMBER_OF_OPENS, 0)
        }

    override var resignTimestamp:InstantCompat?
        set(value) {
            val editor = preferences.edit()
            editor.putString(OPENGROW_RESIGN_TIMESTAMP, value.toString())
            editor.apply()
        }
        get() {
            val string = preferences.getString(OPENGROW_RESIGN_TIMESTAMP, null)
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
            editor.putString(OPENGROW_LAST_START_TIMESTAMP, value.toString())
            editor.apply()
        }
        get() {
            val string = preferences.getString(OPENGROW_LAST_START_TIMESTAMP, null)
            string?.let {
                val instant = InstantCompat.parse(it)
                return instant
            } ?: run {
                return null
            }
        }

}
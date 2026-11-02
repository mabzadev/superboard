package io.superboard.e2e

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import io.superboard.SuperBoard

class TestActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(androidx.appcompat.R.style.Theme_AppCompat_Light_NoActionBar)
        super.onCreate(savedInstanceState)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent?.let { SuperBoard.onNewIntent(it, this) }
    }

    override fun onStart() {
        super.onStart()
        SuperBoard.onStart(this)
    }
}

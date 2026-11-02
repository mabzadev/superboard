package io.superboard.utils

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.webkit.WebSettings
import android.webkit.WebView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking

class WebViewUtils {
    companion object {
        private val defaultUserAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36"
        private var cachedUserAgent: String? = null

        fun getUserAgent(context: Context): String {
            cachedUserAgent?.let { return it }

            try {
                if (Thread.currentThread().name.contains("main", ignoreCase = true)) {
                    val webView = WebView(context)

                    val webSettings: WebSettings = webView.settings

                    val userAgent = webSettings.userAgentString
                    val processedUserAgent = parseUserAgent(userAgent = userAgent, browserVersion = getChromeVersion(context = context))

                    cachedUserAgent = processedUserAgent

                    return processedUserAgent
                } else {
                    val result = runBlocking(Dispatchers.Main) {
                        val webView = WebView(context)

                        val webSettings: WebSettings = webView.settings

                        val userAgent = webSettings.userAgentString
                        val processedUserAgent = parseUserAgent(userAgent = userAgent, browserVersion = getChromeVersion(context = context))

                        processedUserAgent
                    }
                    cachedUserAgent = result

                    return result
                }
            } catch (e: Exception) {
                return defaultUserAgent
            }
        }

        fun parseUserAgent(userAgent: String, browserVersion: String?): String {
            try {
                val mozillaVersionRegex = """Mozilla/(\d+\.\d+)""".toRegex()
                val browserEngineRegex = """AppleWebKit/(\d+\.\d+)""".toRegex()
                val browserNameRegex = """Chrome/(\d+)""".toRegex()
                val mobileSafariVersionRegex = """Mobile Safari/(\d+\.\d+)""".toRegex()

                val mozillaVersion = mozillaVersionRegex.find(userAgent)?.groupValues?.get(1) ?: "5.0"
                val browserEngine = browserEngineRegex.find(userAgent)?.groupValues?.get(1) ?: "537.36"
                val browserName = browserVersion ?: browserNameRegex.find(userAgent)?.groupValues?.get(1) ?: "127"
                val mobileSafariVersion = mobileSafariVersionRegex.find(userAgent)?.groupValues?.get(1) ?: "537.36"

                return "Mozilla/$mozillaVersion (Linux; Android 10; K) AppleWebKit/$browserEngine (KHTML, like Gecko) Chrome/$browserName.0.0.0 Mobile Safari/$mobileSafariVersion"
            } catch (e: Exception) {
                return defaultUserAgent
            }
        }

        fun getChromeVersion(context: Context): String? {
            val chromePackage = "com.android.chrome"
            val packageManager = context.packageManager

            return try {
                val packageInfo: PackageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    packageManager.getPackageInfo(
                        chromePackage,
                        PackageManager.PackageInfoFlags.of(0)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getPackageInfo(chromePackage, 0)
                }

                val fullVersion = packageInfo.versionName
                fullVersion?.substringBefore('.')
            } catch (e: PackageManager.NameNotFoundException) {
                null
            } catch (e: Exception) {
                null
            }
        }
    }
}

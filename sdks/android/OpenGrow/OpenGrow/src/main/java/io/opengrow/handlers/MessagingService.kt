package io.opengrow.handlers

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.opengrow.R
import io.opengrow.model.DebugLogger
import io.opengrow.model.LogLevel
import kotlin.random.Random

class MessagingService: FirebaseMessagingService() {

    override fun onCreate() {
        super.onCreate()

    }

    override fun onMessageReceived(message: RemoteMessage) {
        DebugLogger.instance.log(LogLevel.INFO, "Push notification handled by opengrow FirebaseMessagingService service.")
        if (handleOpenGrowNotification(message)) {
            DebugLogger.instance.log(LogLevel.INFO, "Push notification if from opengrow -> handled.")
        } else {
            DebugLogger.instance.log(LogLevel.INFO, "Push notification if NOT from opengrow -> ignored.")
        }
    }

    override fun onDestroy() {
        super.onDestroy()

    }

}

fun FirebaseMessagingService.handleOpenGrowNotification(message: RemoteMessage): Boolean {
    val data = message.data
    if (data["linksquared"] == null) {
        return false
    }

    DebugLogger.instance.log(LogLevel.INFO, "Received push notification: ${message.notification} data: ${message.data} ")

    // Retrieve the drawable name from meta-data
    val applicationInfo = packageManager.getApplicationInfo(
        packageName,
        PackageManager.GET_META_DATA
    )
    val iconName = applicationInfo.metaData?.getString("io.opengrow.NotificationIconSmall")
    // Get the drawable resource ID
    val iconResId = iconName?.let { resources.getIdentifier(it, "drawable", packageName) }

    handleOpenGrowNotification(message.notification?.title, message.notification?.body, iconResId ?: R.drawable.ic_opengrow_notification_default_small)

    return true
}

private fun FirebaseMessagingService.handleOpenGrowNotification(title: String?, body: String?, smallIcon: Int) {
    val channelId = "OpenGrowChannel"

    // Build the notification
    val notificationBuilder = NotificationCompat.Builder(this, channelId)
        .setSmallIcon(smallIcon)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)

    // Send the notification
    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    val channel = NotificationChannel(channelId, "OpenGrow Channel", NotificationManager.IMPORTANCE_HIGH)
    channel.description = "Channel for OpenGrow messages"
    channel.enableLights(true)
    channel.lightColor = getColor(R.color.opengrow_push_notification_icon_tint)
    channel.enableVibration(true)

    notificationManager.createNotificationChannel(channel)

    var notificationId = Random.nextInt(1000, Int.MAX_VALUE)
    notificationManager.notify(notificationId, notificationBuilder.build())
}
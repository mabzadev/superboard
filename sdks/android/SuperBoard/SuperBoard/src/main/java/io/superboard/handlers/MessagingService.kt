package io.superboard.handlers

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.superboard.R
import io.superboard.model.DebugLogger
import io.superboard.model.LogLevel
import kotlin.random.Random

class MessagingService: FirebaseMessagingService() {

    override fun onCreate() {
        super.onCreate()

    }

    override fun onMessageReceived(message: RemoteMessage) {
        DebugLogger.instance.log(LogLevel.INFO, "Push notification handled by superboard FirebaseMessagingService service.")
        if (handleSuperBoardNotification(message)) {
            DebugLogger.instance.log(LogLevel.INFO, "Push notification if from superboard -> handled.")
        } else {
            DebugLogger.instance.log(LogLevel.INFO, "Push notification if NOT from superboard -> ignored.")
        }
    }

    override fun onDestroy() {
        super.onDestroy()

    }

}

fun FirebaseMessagingService.handleSuperBoardNotification(message: RemoteMessage): Boolean {
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
    val iconName = applicationInfo.metaData?.getString("io.superboard.NotificationIconSmall")
    // Get the drawable resource ID
    val iconResId = iconName?.let { resources.getIdentifier(it, "drawable", packageName) }

    handleSuperBoardNotification(message.notification?.title, message.notification?.body, iconResId ?: R.drawable.ic_superboard_notification_default_small)

    return true
}

private fun FirebaseMessagingService.handleSuperBoardNotification(title: String?, body: String?, smallIcon: Int) {
    val channelId = "SuperBoardChannel"

    // Build the notification
    val notificationBuilder = NotificationCompat.Builder(this, channelId)
        .setSmallIcon(smallIcon)
        .setContentTitle(title)
        .setContentText(body)
        .setAutoCancel(true)

    // Send the notification
    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    val channel = NotificationChannel(channelId, "SuperBoard Channel", NotificationManager.IMPORTANCE_HIGH)
    channel.description = "Channel for SuperBoard messages"
    channel.enableLights(true)
    channel.lightColor = getColor(R.color.superboard_push_notification_icon_tint)
    channel.enableVibration(true)

    notificationManager.createNotificationChannel(channel)

    var notificationId = Random.nextInt(1000, Int.MAX_VALUE)
    notificationManager.notify(notificationId, notificationBuilder.build())
}
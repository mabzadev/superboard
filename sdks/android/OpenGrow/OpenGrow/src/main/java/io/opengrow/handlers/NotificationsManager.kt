package io.opengrow.handlers

import android.app.Activity
import android.content.Context
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import io.opengrow.OpenGrowNotificationsListener
import io.opengrow.fragments.AutoDisplayedNotificationFragment
import io.opengrow.fragments.NotificationsMainFragment
import io.opengrow.model.notifications.Notification
import io.opengrow.service.OpenGrowService
import io.opengrow.utils.LSResult
import kotlinx.coroutines.launch

interface ActivityProvider {
    fun requireActivity(): Activity?
    fun requireNotificationsListener(): OpenGrowNotificationsListener?
}

class NotificationsManager(val context: Context, val opengrowContext: OpenGrowContext, apiKey: String, val activityProvider: ActivityProvider) {
    private val opengrowService = OpenGrowService(context = context, apiKey = apiKey, opengrowContext = opengrowContext)

    fun displayAutomaticNotificationsIfNeeded() {
        val activity = activityProvider.requireActivity() as? FragmentActivity
        activity?.lifecycleScope?.launch {
            val result = opengrowService.notificationsToDisplayAutomatically()
            when (result) {
                is LSResult.Success -> {
                    for (notification in result.data.notifications ?: emptyList()) {
                        displayAutomaticNotificationFor(notification = notification)
                    }
                }
                is LSResult.Error -> {}
            }
        }

//        val activity = activityProvider.requireActivity() as? FragmentActivity
//        activity?.lifecycleScope?.launch {
//            val notification = Notification(
//                123,
//                "Test not",
//                Instant.now(),
//                "Test sub",
//                autoDisplay = true,
//                "https:google.ro",
//                read = false
//            )
//            displayAutomaticNotificationFor(notification)
//
//            val notification2 = Notification(
//                1234,
//                "Test not",
//                Instant.now(),
//                "Test sub",
//                autoDisplay = true,
//                "https:google.ro",
//                read = false
//            )
//            displayAutomaticNotificationFor(notification2)
//        }
    }

    fun displayNotificationsViewController(onDismissed: (()->Unit)?): Boolean {
        val activity = activityProvider.requireActivity() as? FragmentActivity
        activity?.let { activity ->
            val count = activity.supportFragmentManager.fragments.filterIsInstance<NotificationsMainFragment>().count { it.isVisible }
            if (count != 0) {
                return true
            }

            val dialogFragment = NotificationsMainFragment(opengrowService = opengrowService)
            dialogFragment.onDialogDismissed = onDismissed
            dialogFragment.show(activity.supportFragmentManager, "NotificationsMainFragment")
            activity.supportFragmentManager.executePendingTransactions()

            return true
        } ?: run {
            return false
        }
    }

    suspend fun numberOfUnreadNotifications(): Int? {
        val result = opengrowService.numberOfUnreadNotifications()
        when (result) {
            is LSResult.Success -> {
                return result.data.numberOfUnreadNotifications
            }
            is LSResult.Error -> {
                return null
            }
        }
    }

    private fun displayAutomaticNotificationFor(notification: Notification) {
        val activity = activityProvider.requireActivity() as? FragmentActivity
        activity?.let { activity ->
            val alreadyShownFragment = activity.supportFragmentManager.findFragmentByTag(notification.id.toString())
            if (alreadyShownFragment == null) {
                val dialogFragment = AutoDisplayedNotificationFragment.newInstance(notification = notification, opengrowService = opengrowService)
                dialogFragment.onDialogDismissed = {
                    val count = activity.supportFragmentManager.fragments.filterIsInstance<AutoDisplayedNotificationFragment>().count { it.isVisible }
                    activityProvider.requireNotificationsListener()?.onAutomaticNotificationClosed(count == 0)
                }
                dialogFragment.show(activity.supportFragmentManager, notification.id.toString())
                activity.supportFragmentManager.executePendingTransactions()
            }
        }
    }

}
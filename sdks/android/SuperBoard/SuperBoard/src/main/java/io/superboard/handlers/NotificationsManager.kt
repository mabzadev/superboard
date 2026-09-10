package io.superboard.handlers

import android.app.Activity
import android.content.Context
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import io.superboard.SuperBoardNotificationsListener
import io.superboard.fragments.AutoDisplayedNotificationFragment
import io.superboard.fragments.NotificationsMainFragment
import io.superboard.model.notifications.Notification
import io.superboard.service.SuperBoardService
import io.superboard.utils.LSResult
import kotlinx.coroutines.launch

interface ActivityProvider {
    fun requireActivity(): Activity?
    fun requireNotificationsListener(): SuperBoardNotificationsListener?
}

class NotificationsManager(val context: Context, val superboardContext: SuperBoardContext, apiKey: String, val activityProvider: ActivityProvider) {
    private val superboardService = SuperBoardService(context = context, apiKey = apiKey, superboardContext = superboardContext)

    fun displayAutomaticNotificationsIfNeeded() {
        val activity = activityProvider.requireActivity() as? FragmentActivity
        activity?.lifecycleScope?.launch {
            val result = superboardService.notificationsToDisplayAutomatically()
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

            val dialogFragment = NotificationsMainFragment(superboardService = superboardService)
            dialogFragment.onDialogDismissed = onDismissed
            dialogFragment.show(activity.supportFragmentManager, "NotificationsMainFragment")
            activity.supportFragmentManager.executePendingTransactions()

            return true
        } ?: run {
            return false
        }
    }

    suspend fun numberOfUnreadNotifications(): Int? {
        val result = superboardService.numberOfUnreadNotifications()
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
                val dialogFragment = AutoDisplayedNotificationFragment.newInstance(notification = notification, superboardService = superboardService)
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
package io.opengrow.viewmodels

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.opengrow.model.notifications.Notification
import io.opengrow.service.OpenGrowService
import kotlinx.coroutines.launch

class AutoDisplayedNotificationViewModel(application: Application) : AndroidViewModel(application) {
    lateinit var opengrowService: OpenGrowService

    fun markAsRead(notification: Notification) {
        viewModelScope.launch {
            val result = opengrowService.markNotificationAsRead(notificationId = notification.id)
        }
    }

}
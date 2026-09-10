package io.superboard.viewmodels

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.superboard.model.notifications.Notification
import io.superboard.service.SuperBoardService
import kotlinx.coroutines.launch

class AutoDisplayedNotificationViewModel(application: Application) : AndroidViewModel(application) {
    lateinit var superboardService: SuperBoardService

    fun markAsRead(notification: Notification) {
        viewModelScope.launch {
            val result = superboardService.markNotificationAsRead(notificationId = notification.id)
        }
    }

}
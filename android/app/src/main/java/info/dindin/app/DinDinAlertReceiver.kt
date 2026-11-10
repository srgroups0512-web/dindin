package info.dindin.app

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class DinDinAlertReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_ALERT -> {
        val notificationId = intent.getStringExtra(DinDinAlertService.EXTRA_NOTIFICATION_ID)
          ?: return
        DinDinAlertScheduler.markFired(context, notificationId)
        val soundEnabled = intent.getBooleanExtra(DinDinAlertService.EXTRA_SOUND, true)
        val vibrationEnabled = intent.getBooleanExtra(DinDinAlertService.EXTRA_VIBRATION, true)
        val alertKey = intent.getStringExtra(DinDinAlertService.EXTRA_ALERT_KEY) ?: notificationId
        val stage = intent.getIntExtra(DinDinAlertService.EXTRA_STAGE, 1)
        if (!soundEnabled && !vibrationEnabled && stage != 2) {
          DinDinAlertDeliveryLedger.claim(context, alertKey)
          return
        }
        ContextCompat.startForegroundService(
          context,
          DinDinAlertService.startIntent(
            context,
            soundEnabled,
            vibrationEnabled,
            intent.getLongExtra(
              DinDinAlertService.EXTRA_DURATION_MS,
              DinDinAlertService.DEFAULT_DURATION_MS,
            ),
            alertKey,
            notificationId,
            intent.getStringExtra(DinDinAlertService.EXTRA_SCHEDULE_ID).orEmpty(),
            intent.getStringExtra(DinDinAlertService.EXTRA_OCCURRENCE).orEmpty(),
            stage,
          ),
        )
      }

      ACTION_OKAY,
      ACTION_NOT_OKAY,
      -> handleReminderResponse(context, intent)

      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      -> DinDinAlertScheduler.rescheduleAll(context)
    }
  }

  private fun handleReminderResponse(context: Context, intent: Intent) {
    val scheduleId = intent.getStringExtra(DinDinAlertService.EXTRA_SCHEDULE_ID).orEmpty()
    val occurrence = intent.getStringExtra(DinDinAlertService.EXTRA_OCCURRENCE).orEmpty()
    val notificationId = intent.getStringExtra(DinDinAlertService.EXTRA_NOTIFICATION_ID).orEmpty()
    if (scheduleId.isEmpty() || occurrence.isEmpty()) return
    val action = if (intent.action == ACTION_NOT_OKAY) "not-okay" else "okay"

    context.stopService(Intent(context, DinDinAlertService::class.java))
    DinDinAlertScheduler.cancelOccurrence(context, scheduleId, occurrence)
    val numericNotificationId = notificationId.hashCode().let { if (it == 0) 1 else it }
    context.getSystemService(NotificationManager::class.java).cancel(numericNotificationId)
    DinDinPendingActionStore.enqueue(context, scheduleId, occurrence, action)

    context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      context.startActivity(this)
    }
  }

  companion object {
    const val ACTION_ALERT = "info.dindin.app.action.ALERT"
    const val ACTION_OKAY = "info.dindin.app.action.REMINDER_OKAY"
    const val ACTION_NOT_OKAY = "info.dindin.app.action.REMINDER_NOT_OKAY"
  }
}

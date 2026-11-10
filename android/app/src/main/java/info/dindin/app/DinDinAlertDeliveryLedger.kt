package info.dindin.app

import android.content.Context

/**
 * A process-independent record of alarms that have already reached the device.
 *
 * Local AlarmManager delivery and Firebase are intentionally redundant. Firebase
 * can arrive after the one-minute local alarm has ended, so an in-memory guard is
 * not enough to prevent the same occurrence/stage from ringing twice.
 */
object DinDinAlertDeliveryLedger {
  private const val PREFS_NAME = "dindin_alert_delivery_ledger"
  private const val RECENT_DELIVERY_WINDOW_MS = 15 * 60_000L
  private const val RETENTION_MS = 24 * 60 * 60_000L

  @Synchronized
  fun claim(context: Context, alertKey: String, now: Long = System.currentTimeMillis()): Boolean {
    if (alertKey.isBlank()) return true
    val preferences = context.applicationContext.getSharedPreferences(
      PREFS_NAME,
      Context.MODE_PRIVATE,
    )
    val lastDeliveredAt = preferences.getLong(alertKey, 0L)
    if (lastDeliveredAt > now - RECENT_DELIVERY_WINDOW_MS) return false

    val editor = preferences.edit()
    preferences.all.forEach { (key, value) ->
      if (value is Long && value <= now - RETENTION_MS) editor.remove(key)
    }
    editor.putLong(alertKey, now).commit()
    return true
  }

  @Synchronized
  fun wasRecentlyDelivered(
    context: Context,
    alertKey: String,
    now: Long = System.currentTimeMillis(),
  ): Boolean {
    if (alertKey.isBlank()) return false
    val deliveredAt = context.applicationContext
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getLong(alertKey, 0L)
    return deliveredAt > now - RECENT_DELIVERY_WINDOW_MS
  }
}

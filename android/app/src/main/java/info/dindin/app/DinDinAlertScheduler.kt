package info.dindin.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.edit
import androidx.core.net.toUri
import org.json.JSONObject

object DinDinAlertScheduler {
  private const val PREFS_NAME = "dindin_native_alerts"
  private const val PREFS_KEY = "scheduled_alerts"

  data class AlertSpec(
    val notificationId: String,
    val scheduleId: String,
    val occurrence: String,
    val stage: Int,
    val timestamp: Long,
    val soundEnabled: Boolean,
    val vibrationEnabled: Boolean,
    val durationMs: Long,
  ) {
    val alertKey: String
      get() = notificationId

    fun encode(): String = JSONObject()
      .put("notificationId", notificationId)
      .put("scheduleId", scheduleId)
      .put("occurrence", occurrence)
      .put("stage", stage)
      .put("timestamp", timestamp)
      .put("sound", soundEnabled)
      .put("vibration", vibrationEnabled)
      .put("durationMs", durationMs)
      .toString()

    companion object {
      fun decode(value: String): AlertSpec? = try {
        val json = JSONObject(value)
        AlertSpec(
          notificationId = json.getString("notificationId"),
          scheduleId = json.getString("scheduleId"),
          occurrence = json.getString("occurrence"),
          stage = json.optInt("stage", if (json.getString("notificationId").endsWith("-2")) 2 else 1),
          timestamp = json.getLong("timestamp"),
          soundEnabled = json.optBoolean("sound", true),
          vibrationEnabled = json.optBoolean("vibration", true),
          durationMs = json.optLong("durationMs", DinDinAlertService.DEFAULT_DURATION_MS),
        )
      } catch (_: Exception) {
        null
      }
    }
  }

  fun replaceAll(context: Context, specs: List<AlertSpec>) {
    cancelAll(context)
    val future = specs.filter { it.timestamp > System.currentTimeMillis() }
    save(context, future)
    future.forEach { schedule(context, it) }
  }

  fun cancelAll(context: Context) {
    read(context).forEach { cancel(context, it) }
    save(context, emptyList())
  }

  fun cancelOccurrence(context: Context, scheduleId: String, occurrence: String) {
    val specs = read(context)
    val (cancelled, remaining) = specs.partition {
      it.scheduleId == scheduleId && it.occurrence == occurrence
    }
    cancelled.forEach { cancel(context, it) }
    save(context, remaining)
  }

  fun rescheduleAll(context: Context) {
    val now = System.currentTimeMillis()
    val future = read(context).filter { it.timestamp > now }
    save(context, future)
    future.forEach { schedule(context, it) }
  }

  fun markFired(context: Context, notificationId: String) {
    save(context, read(context).filterNot { it.notificationId == notificationId })
  }

  private fun schedule(context: Context, spec: AlertSpec) {
    val alarmManager = context.getSystemService(AlarmManager::class.java)
    val operation = pendingIntent(context, spec, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()) {
      alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, spec.timestamp, operation)
    } else {
      alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, spec.timestamp, operation)
    }
  }

  private fun cancel(context: Context, spec: AlertSpec) {
    val alarmManager = context.getSystemService(AlarmManager::class.java)
    val operation = pendingIntent(context, spec, PendingIntent.FLAG_NO_CREATE) ?: return
    alarmManager.cancel(operation)
    operation.cancel()
  }

  private fun pendingIntent(
    context: Context,
    spec: AlertSpec,
    creationFlag: Int,
  ): PendingIntent? {
    val intent = Intent(context, DinDinAlertReceiver::class.java).apply {
      action = DinDinAlertReceiver.ACTION_ALERT
      data = "dindin://native-alert/${Uri.encode(spec.notificationId)}".toUri()
      putExtra(DinDinAlertService.EXTRA_ALERT_KEY, spec.alertKey)
      putExtra(DinDinAlertService.EXTRA_NOTIFICATION_ID, spec.notificationId)
      putExtra(DinDinAlertService.EXTRA_SOUND, spec.soundEnabled)
      putExtra(DinDinAlertService.EXTRA_VIBRATION, spec.vibrationEnabled)
      putExtra(DinDinAlertService.EXTRA_DURATION_MS, spec.durationMs)
      putExtra(DinDinAlertService.EXTRA_SCHEDULE_ID, spec.scheduleId)
      putExtra(DinDinAlertService.EXTRA_OCCURRENCE, spec.occurrence)
      putExtra(DinDinAlertService.EXTRA_STAGE, spec.stage)
    }
    return PendingIntent.getBroadcast(
      context,
      spec.notificationId.hashCode(),
      intent,
      creationFlag or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun read(context: Context): List<AlertSpec> =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getStringSet(PREFS_KEY, emptySet())
      .orEmpty()
      .mapNotNull(AlertSpec::decode)

  private fun save(context: Context, specs: List<AlertSpec>) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit {
      putStringSet(PREFS_KEY, specs.mapTo(mutableSetOf(), AlertSpec::encode))
    }
  }
}

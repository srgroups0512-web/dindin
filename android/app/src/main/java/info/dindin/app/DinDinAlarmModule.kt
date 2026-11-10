package info.dindin.app

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.Arguments

class DinDinAlarmModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "DinDinAlarm"

  @ReactMethod
  fun startAlert(
    soundEnabled: Boolean,
    vibrationEnabled: Boolean,
    durationMs: Double,
    alertKey: String,
    notificationId: String,
    scheduleId: String,
    occurrence: String,
    stage: Double,
  ) {
    if (!soundEnabled && !vibrationEnabled && stage.toInt() != 2) return
    ContextCompat.startForegroundService(
      reactContext.applicationContext,
      DinDinAlertService.startIntent(
        reactContext.applicationContext,
        soundEnabled,
        vibrationEnabled,
        durationMs.toLong(),
        alertKey,
        notificationId,
        scheduleId,
        occurrence,
        stage.toInt(),
      ),
    )
  }

  @ReactMethod
  fun stopAlert() {
    reactContext.applicationContext.stopService(
      Intent(reactContext.applicationContext, DinDinAlertService::class.java),
    )
  }

  @ReactMethod
  fun replaceScheduledAlerts(alerts: ReadableArray) {
    val specs = buildList {
      for (index in 0 until alerts.size()) {
        val item = alerts.getMap(index) ?: continue
        val notificationId = item.getString("notificationId") ?: continue
        val scheduleId = item.getString("scheduleId") ?: continue
        val occurrence = item.getString("occurrence") ?: continue
        if (!item.hasKey("timestamp") || item.isNull("timestamp")) continue
        add(
          DinDinAlertScheduler.AlertSpec(
            notificationId = notificationId,
            scheduleId = scheduleId,
            occurrence = occurrence,
            stage = if (item.hasKey("stage")) item.getInt("stage") else 1,
            timestamp = item.getDouble("timestamp").toLong(),
            soundEnabled = item.hasKey("sound") && item.getBoolean("sound"),
            vibrationEnabled = item.hasKey("vibration") && item.getBoolean("vibration"),
            durationMs = if (item.hasKey("durationMs") && !item.isNull("durationMs")) {
              item.getDouble("durationMs").toLong()
            } else {
              DinDinAlertService.DEFAULT_DURATION_MS
            },
          ),
        )
      }
    }
    DinDinAlertScheduler.replaceAll(reactContext.applicationContext, specs)
  }

  @ReactMethod
  fun cancelScheduledAlerts() {
    DinDinAlertScheduler.cancelAll(reactContext.applicationContext)
  }

  @ReactMethod
  fun cancelOccurrence(scheduleId: String, occurrence: String) {
    DinDinAlertScheduler.cancelOccurrence(
      reactContext.applicationContext,
      scheduleId,
      occurrence,
    )
  }

  @ReactMethod
  fun wasAlertDeliveredRecently(alertKey: String, promise: Promise) {
    promise.resolve(
      DinDinAlertDeliveryLedger.wasRecentlyDelivered(
        reactContext.applicationContext,
        alertKey,
      ),
    )
  }

  @ReactMethod
  fun consumePendingActions(promise: Promise) {
    val values = Arguments.createArray()
    DinDinPendingActionStore.consume(reactContext.applicationContext).forEach { action ->
      values.pushMap(Arguments.createMap().apply {
        putString("scheduleId", action.scheduleId)
        putString("occurrence", action.occurrence)
        putString("action", action.action)
      })
    }
    promise.resolve(values)
  }

  @ReactMethod
  fun configureSafetyLocation(apiBaseUrl: String, token: String) {
    DinDinSafetyLocationReporter.configure(reactContext.applicationContext, apiBaseUrl, token)
  }

  @ReactMethod
  fun clearSafetyLocationConfiguration() {
    DinDinSafetyLocationReporter.clear(reactContext.applicationContext)
  }
}

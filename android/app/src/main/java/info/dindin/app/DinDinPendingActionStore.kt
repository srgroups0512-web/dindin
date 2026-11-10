package info.dindin.app

import android.content.Context
import androidx.core.content.edit
import org.json.JSONArray
import org.json.JSONObject

object DinDinPendingActionStore {
  private const val PREFS_NAME = "dindin_pending_reminder_actions"
  private const val PREFS_KEY = "actions"
  private const val RETENTION_MS = 24 * 60 * 60_000L

  data class PendingAction(
    val scheduleId: String,
    val occurrence: String,
    val action: String,
    val createdAt: Long,
  ) {
    fun encode(): JSONObject = JSONObject()
      .put("scheduleId", scheduleId)
      .put("occurrence", occurrence)
      .put("action", action)
      .put("createdAt", createdAt)
  }

  @Synchronized
  fun enqueue(context: Context, scheduleId: String, occurrence: String, action: String) {
    val now = System.currentTimeMillis()
    val values = read(context, now).toMutableList()
    if (values.none { it.scheduleId == scheduleId && it.occurrence == occurrence }) {
      values.add(PendingAction(scheduleId, occurrence, action, now))
    }
    write(context, values)
  }

  @Synchronized
  fun consume(context: Context): List<PendingAction> {
    val values = read(context, System.currentTimeMillis())
    write(context, emptyList())
    return values
  }

  private fun read(context: Context, now: Long): List<PendingAction> {
    val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .getString(PREFS_KEY, null) ?: return emptyList()
    return try {
      val array = JSONArray(raw)
      buildList {
        for (index in 0 until array.length()) {
          val item = array.optJSONObject(index) ?: continue
          val createdAt = item.optLong("createdAt", 0L)
          val scheduleId = item.optString("scheduleId")
          val occurrence = item.optString("occurrence")
          val action = item.optString("action")
          if (
            scheduleId.isNotEmpty() &&
            occurrence.isNotEmpty() &&
            action in setOf("okay", "not-okay") &&
            createdAt >= now - RETENTION_MS
          ) {
            add(PendingAction(scheduleId, occurrence, action, createdAt))
          }
        }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun write(context: Context, values: List<PendingAction>) {
    val array = JSONArray()
    values.forEach { array.put(it.encode()) }
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit {
      putString(PREFS_KEY, array.toString())
    }
  }
}

package info.dindin.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Captures a new fix while the stage-two foreground service is running. */
object DinDinSafetyLocationReporter {
  private const val PREFS_NAME = "dindin_safety_location_reporter"
  private const val API_URL_KEY = "api_url"
  private const val TOKEN_KEY = "token"
  private const val CAPTURE_TIMEOUT_MS = 20_000L
  private const val MAX_FIX_AGE_MS = 2 * 60_000L
  private const val TAG = "DinDinSafetyLocation"
  private val networkExecutor = Executors.newSingleThreadExecutor()

  fun configure(context: Context, apiBaseUrl: String, token: String) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit {
      putString(API_URL_KEY, apiBaseUrl.trimEnd('/'))
      putString(TOKEN_KEY, token)
    }
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit { clear() }
  }

  fun captureAndUpload(context: Context) {
    val appContext = context.applicationContext
    val fine = ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_FINE_LOCATION)
    val coarse = ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_COARSE_LOCATION)
    if (fine != PackageManager.PERMISSION_GRANTED && coarse != PackageManager.PERMISSION_GRANTED) {
      Log.w(TAG, "Fresh location skipped because location permission is unavailable")
      return
    }
    val preferences = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val apiBaseUrl = preferences.getString(API_URL_KEY, null)
    val token = preferences.getString(TOKEN_KEY, null)
    if (apiBaseUrl.isNullOrBlank() || token.isNullOrBlank()) {
      Log.w(TAG, "Fresh location skipped because the authenticated endpoint is unavailable")
      return
    }

    val manager = appContext.getSystemService(LocationManager::class.java)
    val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
      .filter { provider -> runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false) }
    if (providers.isEmpty()) {
      Log.w(TAG, "Fresh location skipped because no location provider is enabled")
      return
    }

    val completed = AtomicBoolean(false)
    val mainHandler = Handler(Looper.getMainLooper())
    lateinit var listener: LocationListener
    fun finish(location: Location?) {
      if (!completed.compareAndSet(false, true)) return
      mainHandler.removeCallbacksAndMessages(listener)
      runCatching { manager.removeUpdates(listener) }
      if (location == null) {
        Log.w(TAG, "Fresh location capture timed out")
        return
      }
      val age = System.currentTimeMillis() - location.time
      if (age < 0 || age > MAX_FIX_AGE_MS) {
        Log.w(TAG, "Rejected stale native location fix (age=${age}ms)")
        return
      }
      networkExecutor.execute { upload(apiBaseUrl, token, location) }
    }

    listener = object : LocationListener {
      override fun onLocationChanged(location: Location) = finish(location)
      @Deprecated("Deprecated in Android")
      override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
      override fun onProviderEnabled(provider: String) = Unit
      override fun onProviderDisabled(provider: String) = Unit
    }
    try {
      providers.forEach { manager.requestLocationUpdates(it, 0L, 0f, listener, Looper.getMainLooper()) }
      mainHandler.postAtTime({ finish(null) }, listener, android.os.SystemClock.uptimeMillis() + CAPTURE_TIMEOUT_MS)
    } catch (error: SecurityException) {
      Log.e(TAG, "Fresh location permission was revoked", error)
      finish(null)
    } catch (error: Exception) {
      Log.e(TAG, "Could not request a fresh location", error)
      finish(null)
    }
  }

  private fun upload(apiBaseUrl: String, token: String, location: Location) {
    var connection: HttpURLConnection? = null
    try {
      connection = (URL("$apiBaseUrl/v1/me/safety-location").openConnection() as HttpURLConnection).apply {
        requestMethod = "PUT"
        connectTimeout = 10_000
        readTimeout = 10_000
        doOutput = true
        setRequestProperty("Authorization", "Bearer $token")
        setRequestProperty("Content-Type", "application/json")
      }
      val payload = JSONObject()
        .put("latitude", location.latitude)
        .put("longitude", location.longitude)
        .put("accuracy", location.accuracy.toDouble())
        .put("capturedAt", Instant.ofEpochMilli(location.time).toString())
        .toString()
      connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
      val status = connection.responseCode
      if (status in 200..299) Log.i(TAG, "Uploaded a fresh stage-two safety location")
      else Log.e(TAG, "Fresh location upload failed with HTTP $status")
    } catch (error: Exception) {
      Log.e(TAG, "Fresh location upload failed", error)
    } finally {
      connection?.disconnect()
    }
  }
}

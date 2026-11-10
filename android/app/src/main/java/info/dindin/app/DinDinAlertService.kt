package info.dindin.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.Manifest
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.VibrationAttributes
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri

class DinDinAlertService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null
  private var stopRunnable: Runnable? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var currentAlertKey: String? = null
  private var currentNotificationId = 0
  private var endsAtElapsed = 0L
  private var attemptedFallbackSound = false

  private val audioAttributes: AudioAttributes by lazy {
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action != ACTION_START) return START_NOT_STICKY
    val soundEnabled = intent.getBooleanExtra(EXTRA_SOUND, true)
    val vibrationEnabled = intent.getBooleanExtra(EXTRA_VIBRATION, true)
    val stage = intent.getIntExtra(EXTRA_STAGE, 1)
    if (!soundEnabled && !vibrationEnabled && stage != 2) {
      stopSelf()
      return START_NOT_STICKY
    }

    val alertKey = intent.getStringExtra(EXTRA_ALERT_KEY).orEmpty()
    val notificationStringId = intent.getStringExtra(EXTRA_NOTIFICATION_ID).orEmpty()
    val scheduleId = intent.getStringExtra(EXTRA_SCHEDULE_ID).orEmpty()
    val occurrence = intent.getStringExtra(EXTRA_OCCURRENCE).orEmpty()
    val duration = intent.getLongExtra(EXTRA_DURATION_MS, DEFAULT_DURATION_MS)
      .coerceIn(1_000L, DEFAULT_DURATION_MS)
    val now = SystemClock.elapsedRealtime()
    val resolvedAlertKey = alertKey.ifEmpty { notificationStringId }

    if (resolvedAlertKey.isNotEmpty() && resolvedAlertKey == currentAlertKey && now < endsAtElapsed) {
      Log.i(TAG, "Ignored active duplicate alert delivery for $resolvedAlertKey")
      return START_NOT_STICKY
    }
    if (!DinDinAlertDeliveryLedger.claim(applicationContext, resolvedAlertKey)) {
      Log.i(TAG, "Ignored recently delivered alert $resolvedAlertKey")
      if (currentAlertKey == null) stopSelf(startId)
      return START_NOT_STICKY
    }

    stopAlert(removeForeground = currentAlertKey != null)
    currentAlertKey = resolvedAlertKey
    currentNotificationId = notificationStringId.hashCode().let { if (it == 0) 1 else it }
    endsAtElapsed = now + duration
    attemptedFallbackSound = false

    createServiceChannel()
    startAlertForeground(
      currentNotificationId,
      buildForegroundNotification(scheduleId, occurrence, notificationStringId),
      stage,
    )
    if (stage == 2) DinDinSafetyLocationReporter.captureAndUpload(applicationContext)
    acquireWakeLock(duration)
    requestAudioFocus()
    if (soundEnabled) startSound(useFallback = false)
    if (vibrationEnabled) startVibration()

    stopRunnable = Runnable { stopSelf() }.also { handler.postDelayed(it, duration) }
    Log.i(
      TAG,
      "Started native ${duration}ms alert (key=$currentAlertKey, sound=$soundEnabled, vibration=$vibrationEnabled)",
    )
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    stopAlert(removeForeground = true)
    super.onDestroy()
  }

  private fun startAlertForeground(
    notificationId: Int,
    notification: android.app.Notification,
    stage: Int,
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      startForeground(notificationId, notification)
      return
    }
    var serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    val hasLocationPermission =
      ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (stage == 2 && hasLocationPermission) {
      serviceType = serviceType or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
    }
    startForeground(notificationId, notification, serviceType)
  }

  private fun buildForegroundNotification(
    scheduleId: String,
    occurrence: String,
    notificationId: String,
  ): android.app.Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val builder = NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_dindin)
      .setColor(getColor(R.color.dindin_notification))
      .setContentTitle("Din Din reminder")
      .setContentText("Please confirm that you are okay.")
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setContentIntent(contentIntent)
    if (scheduleId.isNotEmpty() && occurrence.isNotEmpty()) {
      builder
        .addAction(
          R.drawable.ic_stat_dindin,
          "Yes, I'm okay",
          responseIntent(
            DinDinAlertReceiver.ACTION_OKAY,
            scheduleId,
            occurrence,
            notificationId,
          ),
        )
        .addAction(
          R.drawable.ic_stat_dindin,
          "No, alert my circle",
          responseIntent(
            DinDinAlertReceiver.ACTION_NOT_OKAY,
            scheduleId,
            occurrence,
            notificationId,
          ),
        )
    }
    return builder.build()
  }

  private fun responseIntent(
    action: String,
    scheduleId: String,
    occurrence: String,
    notificationId: String,
  ): PendingIntent {
    val intent = Intent(this, DinDinAlertReceiver::class.java).apply {
      this.action = action
      data = "dindin://native-response/${Uri.encode(scheduleId)}/${Uri.encode(occurrence)}/$action".toUri()
      putExtra(EXTRA_SCHEDULE_ID, scheduleId)
      putExtra(EXTRA_OCCURRENCE, occurrence)
      putExtra(EXTRA_NOTIFICATION_ID, notificationId)
    }
    return PendingIntent.getBroadcast(
      this,
      "$scheduleId:$occurrence:$action".hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun createServiceChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(
      SERVICE_CHANNEL_ID,
      "Active Din Din reminders",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Keeps an active safety reminder running reliably."
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun acquireWakeLock(duration: Long) {
    val powerManager = getSystemService(PowerManager::class.java)
    wakeLock = powerManager.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "$packageName:DinDinAlert",
    ).apply {
      setReferenceCounted(false)
      acquire(duration + WAKE_LOCK_GRACE_MS)
    }
  }

  private fun requestAudioFocus() {
    val audioManager = getSystemService(AudioManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(audioAttributes)
        .setOnAudioFocusChangeListener { change ->
          if (change == AudioManager.AUDIOFOCUS_GAIN) {
            try {
              player?.let { active -> if (!active.isPlaying) active.start() }
            } catch (_: IllegalStateException) {
              // A player that has failed is recovered by its error callback.
            }
          }
        }
        .build()
      audioManager.requestAudioFocus(audioFocusRequest!!)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(
        null,
        AudioManager.STREAM_ALARM,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT,
      )
    }
  }

  private fun abandonAudioFocus() {
    val audioManager = getSystemService(AudioManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let(audioManager::abandonAudioFocusRequest)
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(null)
    }
    audioFocusRequest = null
  }

  private fun startSound(useFallback: Boolean) {
    val uri = if (useFallback) {
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    } else {
      RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    } ?: return

    try {
      val nextPlayer = MediaPlayer().apply {
        setAudioAttributes(audioAttributes)
        setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
        setDataSource(applicationContext, uri)
        isLooping = true
      }
      nextPlayer.setOnPreparedListener { prepared ->
        if (player === prepared && SystemClock.elapsedRealtime() < endsAtElapsed) {
          prepared.start()
        }
      }
      nextPlayer.setOnErrorListener { failed, what, extra ->
        Log.e(TAG, "Alarm MediaPlayer failed (what=$what, extra=$extra)")
        if (player === failed) player = null
        failed.release()
        if (!attemptedFallbackSound && SystemClock.elapsedRealtime() < endsAtElapsed) {
          attemptedFallbackSound = true
          handler.post { startSound(useFallback = true) }
        }
        true
      }
      player = nextPlayer
      nextPlayer.prepareAsync()
    } catch (error: Exception) {
      Log.e(TAG, "Could not prepare alarm sound", error)
      player?.release()
      player = null
      if (!attemptedFallbackSound && !useFallback && SystemClock.elapsedRealtime() < endsAtElapsed) {
        attemptedFallbackSound = true
        handler.post { startSound(useFallback = true) }
      }
    }
  }

  private fun startVibration() {
    val vibrator = vibrator()
    if (!vibrator.hasVibrator()) return
    val pattern = longArrayOf(0, 500, 500)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      vibrator.vibrate(
        VibrationEffect.createWaveform(pattern, 0),
        VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM),
      )
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      @Suppress("DEPRECATION")
      vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), audioAttributes)
    } else {
      @Suppress("DEPRECATION")
      vibrator.vibrate(pattern, 0, audioAttributes)
    }
  }

  private fun vibrator(): Vibrator =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      getSystemService(VibratorManager::class.java).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

  private fun stopAlert(removeForeground: Boolean) {
    stopRunnable?.let(handler::removeCallbacks)
    stopRunnable = null
    player?.let { active ->
      try {
        if (active.isPlaying) active.stop()
      } catch (_: IllegalStateException) {
        // Releasing is sufficient if asynchronous preparation is still in progress.
      }
      active.release()
    }
    player = null
    vibrator().cancel()
    abandonAudioFocus()
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    if (removeForeground && currentNotificationId != 0) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    }
    if (currentAlertKey != null) Log.i(TAG, "Stopped native alert $currentAlertKey")
    currentAlertKey = null
    currentNotificationId = 0
    endsAtElapsed = 0L
  }

  companion object {
    const val DEFAULT_DURATION_MS = 60_000L
    const val EXTRA_ALERT_KEY = "alertKey"
    const val EXTRA_NOTIFICATION_ID = "notificationId"
    const val EXTRA_SOUND = "sound"
    const val EXTRA_VIBRATION = "vibration"
    const val EXTRA_DURATION_MS = "durationMs"
    const val EXTRA_SCHEDULE_ID = "scheduleId"
    const val EXTRA_OCCURRENCE = "occurrence"
    const val EXTRA_STAGE = "stage"
    private const val ACTION_START = "info.dindin.app.action.START_ALERT"
    private const val SERVICE_CHANNEL_ID = "dindin-active-alert-service-v1"
    private const val WAKE_LOCK_GRACE_MS = 5_000L
    private const val TAG = "DinDinAlertService"

    fun startIntent(
      context: Context,
      soundEnabled: Boolean,
      vibrationEnabled: Boolean,
      durationMs: Long,
      alertKey: String,
      notificationId: String,
      scheduleId: String,
      occurrence: String,
      stage: Int,
    ): Intent = Intent(context, DinDinAlertService::class.java).apply {
      action = ACTION_START
      putExtra(EXTRA_SOUND, soundEnabled)
      putExtra(EXTRA_VIBRATION, vibrationEnabled)
      putExtra(EXTRA_DURATION_MS, durationMs)
      putExtra(EXTRA_ALERT_KEY, alertKey)
      putExtra(EXTRA_NOTIFICATION_ID, notificationId)
      putExtra(EXTRA_SCHEDULE_ID, scheduleId)
      putExtra(EXTRA_OCCURRENCE, occurrence)
      putExtra(EXTRA_STAGE, stage)
    }
  }
}

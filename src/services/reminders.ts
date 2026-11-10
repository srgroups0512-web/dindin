import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidNotificationSetting,
  AuthorizationStatus,
  EventType,
  type Event,
  TriggerType,
} from '@notifee/react-native';
import {NativeModules, Platform, Vibration} from 'react-native';
import type {AppPreferences, ReminderRule, SelfCheckInSchedule} from '../models';
import {acknowledgeSelfCheckIn, API_BASE_URL, escalateSelfCheckInNow} from './checkIns';
import {captureAndReportSafetyLocation} from './location';
import {
  completeReminderResponse,
  hasHandledReminderOccurrence,
  readPendingReminderResponses,
  readAuthSession,
  readPreferences,
  rememberReminderResponse,
  saveReminderResponseLocation,
  type ReminderResponseAction,
  type StoredReminderResponse,
} from './storage';

const ACTION_CHANNEL = 'dindin-self-checkin-actions-v3';
const CATEGORY_ID = 'dindin-self-checkin';
const NOTIFICATION_PREFIX = 'dindin-self-checkin-';
const OCCURRENCES_TO_SCHEDULE = 20;
const IST_OFFSET_MINUTES = 330;
const ALERT_DURATION_MS = 60_000;
const RESPONSE_RETRY_DELAYS_MS = [0, 750, 1_500];
const reminderResponseDeliveries = new Map<
  string,
  Promise<SelfCheckInSchedule | null>
>();
const reminderResponseSubmissions = new Map<
  string,
  Promise<SelfCheckInSchedule | null>
>();

type DinDinAlarmModule = {
  startAlert: (
    soundEnabled: boolean,
    vibrationEnabled: boolean,
    durationMs: number,
    alertKey: string,
    notificationId: string,
    scheduleId: string,
    occurrence: string,
    stage: number,
  ) => void;
  stopAlert: () => void;
  replaceScheduledAlerts?: (alerts: NativeAlertSpec[]) => void;
  cancelScheduledAlerts?: () => void;
  cancelOccurrence?: (scheduleId: string, occurrence: string) => void;
  wasAlertDeliveredRecently?: (alertKey: string) => Promise<boolean>;
  consumePendingActions?: () => Promise<Array<{
    scheduleId: string;
    occurrence: string;
    action: ReminderResponseAction;
  }>>;
  configureSafetyLocation?: (apiBaseUrl: string, token: string) => void;
  clearSafetyLocationConfiguration?: () => void;
};

type NativeAlertSpec = {
  notificationId: string;
  scheduleId: string;
  occurrence: string;
  stage: number;
  timestamp: number;
  sound: boolean;
  vibration: boolean;
  durationMs: number;
};

function androidAlarm(): DinDinAlarmModule | undefined {
  return NativeModules.DinDinAlarm as DinDinAlarmModule | undefined;
}

type DinDinSafetyLocationModule = {
  configure: (apiBaseUrl: string, token: string) => void;
  clearConfiguration: () => void;
};

function iosSafetyLocation(): DinDinSafetyLocationModule | undefined {
  return NativeModules.DinDinSafetyLocation as DinDinSafetyLocationModule | undefined;
}

function startAndroidAlert(
  soundEnabled: boolean,
  vibrationEnabled: boolean,
  alertKey: string,
  notificationKey: string,
  scheduleId: string,
  occurrence: string,
  stage: 1 | 2,
) {
  if (Platform.OS !== 'android') return;
  const alarm = androidAlarm();
  if (alarm) {
    alarm.startAlert(
      soundEnabled,
      vibrationEnabled,
      ALERT_DURATION_MS,
      alertKey,
      notificationKey,
      scheduleId,
      occurrence,
      stage,
    );
    return;
  }
  if (vibrationEnabled) {
    Vibration.vibrate([0, 500, 500], true);
    setTimeout(() => Vibration.cancel(), ALERT_DURATION_MS);
  }
}

function replaceAndroidScheduledAlerts(alerts: NativeAlertSpec[]) {
  if (Platform.OS === 'android') androidAlarm()?.replaceScheduledAlerts?.(alerts);
}

function cancelAndroidScheduledAlerts() {
  if (Platform.OS === 'android') androidAlarm()?.cancelScheduledAlerts?.();
}

function stopAndroidAlert() {
  if (Platform.OS === 'android') androidAlarm()?.stopAlert();
  Vibration.cancel();
}

async function wasAndroidAlertDeliveredRecently(alertKey: string) {
  if (Platform.OS !== 'android') return false;
  const checker = androidAlarm()?.wasAlertDeliveredRecently;
  if (!checker) return false;
  try {
    return await checker(alertKey);
  } catch {
    // If the native ledger is unavailable, retain Firebase as the fallback.
    return false;
  }
}

function clockMinutes(time: string) {
  const twentyFourHour = /^(\d{2}):(\d{2})$/.exec(time);
  if (twentyFourHour) return Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]);
  const legacy = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time);
  if (!legacy) return null;
  let hour = Number(legacy[1]) % 12;
  if (legacy[3].toUpperCase() === 'PM') hour += 12;
  return hour * 60 + Number(legacy[2]);
}

export function reminderOccurrences(schedule: SelfCheckInSchedule, count = OCCURRENCES_TO_SCHEDULE) {
  const firstOccurrence = new Date(schedule.nextRunAt).getTime();
  if (!Number.isFinite(firstOccurrence)) return [];
  const rules: ReminderRule[] = schedule.reminders?.length
    ? schedule.reminders
    : (schedule.times?.length ? schedule.times : schedule.time ? [schedule.time] : []).map((time, index) => ({
        id: `legacy-${index + 1}`,
        time,
        weekdays: schedule.weekdays?.length ? schedule.weekdays : [0, 1, 2, 3, 4, 5, 6],
      }));
  if (!rules.length) return [];
  const after = Math.max(Date.now(), firstOccurrence - 1);
  const afterIst = new Date(after + IST_OFFSET_MINUTES * 60_000);
  const localDayStart = Date.UTC(
    afterIst.getUTCFullYear(), afterIst.getUTCMonth(), afterIst.getUTCDate(), 0, 0, 0, 0,
  );
  const occurrences: number[] = [];
  for (let dayOffset = 0; dayOffset < 370 && occurrences.length < count; dayOffset += 1) {
    const day = localDayStart + dayOffset * 24 * 60 * 60_000;
    const weekday = new Date(day).getUTCDay();
    const times = rules
      .filter(rule => rule.weekdays.includes(weekday as ReminderRule['weekdays'][number]))
      .map(rule => clockMinutes(rule.time))
      .filter((value): value is number => value != null && value >= 0 && value < 24 * 60)
      .sort((left, right) => left - right);
    for (const minutes of times) {
      const candidate = day + (minutes - IST_OFFSET_MINUTES) * 60_000;
      if (candidate > after) occurrences.push(candidate);
      if (occurrences.length >= count) break;
    }
  }
  return [...new Set(occurrences)].sort((left, right) => left - right).slice(0, count);
}

function notificationId(scheduleId: string, occurrence: number, stage: 1 | 2) {
  return `${NOTIFICATION_PREFIX}${scheduleId}-${occurrence}-${stage}`;
}

function notificationContent(
  scheduleId: string,
  occurrence: number,
  stage: 1 | 2,
  preferences: AppPreferences,
) {
  const title = stage === 1 ? 'Din Din check-in' : 'Second check-in reminder';
  const body = stage === 1
    ? 'Please confirm that you are okay.'
    : 'Please respond now. Your primary contacts will be alerted if this is missed.';
  const data = {
    scheduleId,
    occurrence: String(occurrence),
    stage: String(stage),
    sound: String(preferences.sounds),
    vibrate: String(preferences.vibration),
  };
  return {
    id: notificationId(scheduleId, occurrence, stage),
    title,
    body,
    data,
    android: {
      channelId: ACTION_CHANNEL,
      smallIcon: 'ic_stat_dindin',
      largeIcon: 'ic_launcher',
      color: '#0E9C83',
      category: AndroidCategory.ALARM,
      importance: AndroidImportance.HIGH,
      ongoing: true,
      autoCancel: false,
      loopSound: false,
      timeoutAfter: ALERT_DURATION_MS,
      pressAction: {id: 'default'},
      actions: [
        {
          title: "Yes, I'm okay",
          pressAction: {id: 'dindin-okay'},
        },
        {
          title: 'No, alert my circle',
          pressAction: {id: 'dindin-not-okay'},
        },
      ],
    },
    ios: {
      categoryId: CATEGORY_ID,
      ...(preferences.sounds ? {sound: 'default'} : {}),
      interruptionLevel: 'timeSensitive' as const,
      foregroundPresentationOptions: {
        alert: true,
        badge: true,
        sound: preferences.sounds,
        banner: true,
        list: true,
      },
    },
  };
}

export async function initializeReminderNotifications() {
  await notifee.createChannel({
    id: ACTION_CHANNEL,
    name: 'Din Din reminder actions',
    description: 'Visible safety reminders with Yes and No actions.',
    importance: AndroidImportance.HIGH,
    vibration: false,
  });
  await notifee.setNotificationCategories([
    {
      id: CATEGORY_ID,
      actions: [
        {id: 'dindin-okay', title: "Yes, I'm okay"},
        {id: 'dindin-not-okay', title: 'No, alert my circle', destructive: true},
      ],
    },
  ]);
}

export async function requestReminderPermission() {
  await initializeReminderNotifications();
  const settings = await notifee.requestPermission({sound: true, alert: true, badge: true});
  return {
    notificationsEnabled:
      settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
      settings.authorizationStatus === AuthorizationStatus.PROVISIONAL,
    exactAlarmsEnabled:
      Platform.OS !== 'android' ||
      settings.android.alarm === AndroidNotificationSetting.ENABLED ||
      settings.android.alarm === AndroidNotificationSetting.NOT_SUPPORTED,
  };
}

export async function openExactAlarmSettings() {
  if (Platform.OS === 'android') await notifee.openAlarmPermissionSettings();
}

export async function syncReminderNotifications(
  schedule: SelfCheckInSchedule | null,
  preferences: AppPreferences,
) {
  if (Platform.OS === 'android') {
    const auth = await readAuthSession();
    if (auth) androidAlarm()?.configureSafetyLocation?.(API_BASE_URL, auth.token);
  } else if (Platform.OS === 'ios') {
    const auth = await readAuthSession();
    if (auth) iosSafetyLocation()?.configure(API_BASE_URL, auth.token);
  }
  await initializeReminderNotifications();
  const existing = (await notifee.getTriggerNotificationIds()).filter(id =>
    id.startsWith(NOTIFICATION_PREFIX),
  );
  if (existing.length) await notifee.cancelTriggerNotifications(existing);
  cancelAndroidScheduledAlerts();
  if (!schedule?.active || !preferences.notifications) return;

  const settings = await notifee.getNotificationSettings();
  const useExactAlarm =
    Platform.OS !== 'android' ||
    settings.android.alarm === AndroidNotificationSetting.ENABLED ||
    settings.android.alarm === AndroidNotificationSetting.NOT_SUPPORTED;
  const now = Date.now();
  const currentOccurrence = new Date(schedule.nextRunAt).getTime();
  const waitingForResponse =
    schedule.status === 'waiting-first' || schedule.status === 'waiting-second';
  const occurrences = reminderOccurrences(schedule);
  if (
    waitingForResponse &&
    Number.isFinite(currentOccurrence) &&
    !occurrences.includes(currentOccurrence)
  ) {
    occurrences.unshift(currentOccurrence);
  }
  const nativeAlerts: NativeAlertSpec[] = [];
  for (const occurrence of occurrences) {
    for (const stage of [1, 2] as const) {
      const timestamp = occurrence + (stage === 2 ? 10 * 60_000 : 0);
      if (timestamp <= now) continue;
      const id = notificationId(schedule.id, occurrence, stage);
      await notifee.createTriggerNotification(
        notificationContent(schedule.id, occurrence, stage, preferences),
        {
          type: TriggerType.TIMESTAMP,
          timestamp,
          ...(Platform.OS === 'android' && useExactAlarm
            ? {alarmManager: {allowWhileIdle: true}}
            : {}),
        },
      );
      nativeAlerts.push({
        notificationId: id,
        scheduleId: schedule.id,
        occurrence: String(occurrence),
        stage,
        timestamp,
        sound: preferences.sounds,
        vibration: preferences.vibration,
        durationMs: ALERT_DURATION_MS,
      });
    }
  }
  replaceAndroidScheduledAlerts(nativeAlerts);
}

export async function displayRemoteReminder(
  data: Record<string, string | object> | undefined,
) {
  if (data?.type !== 'dindin-reminder') return;
  const scheduleId = typeof data.scheduleId === 'string' ? data.scheduleId : '';
  const occurrence = Number(data.occurrence);
  const occurrenceKey = String(data.occurrence ?? '');
  const stage: 1 | 2 = Number(data.stage) === 2 ? 2 : 1;
  if (!scheduleId || !Number.isFinite(occurrence) || !occurrenceKey) return;
  if (await hasHandledReminderOccurrence(scheduleId, occurrenceKey)) {
    await retryPendingReminderResponses();
    await cancelOccurrenceNotifications(scheduleId, occurrenceKey);
    return;
  }
  const id = notificationId(scheduleId, occurrence, stage);
  if (await wasAndroidAlertDeliveredRecently(id)) {
    await notifee.cancelNotification(id);
    return;
  }
  const preferences = await readPreferences();
  if (!preferences.notifications) return;
  await initializeReminderNotifications();
  if (await hasHandledReminderOccurrence(scheduleId, occurrenceKey)) {
    await cancelOccurrenceNotifications(scheduleId, occurrenceKey);
    return;
  }
  await notifee.displayNotification(
    notificationContent(scheduleId, occurrence, stage, preferences),
  );
}

async function cancelOccurrenceNotifications(
  scheduleId: string,
  occurrence: string | undefined,
  currentId?: string,
) {
  if (Platform.OS === 'android' && occurrence) {
    androidAlarm()?.cancelOccurrence?.(scheduleId, occurrence);
  }
  const ids = new Set<string>();
  if (currentId) ids.add(currentId);
  if (occurrence) {
    ids.add(notificationId(scheduleId, Number(occurrence), 1));
    ids.add(notificationId(scheduleId, Number(occurrence), 2));
  }
  await Promise.all([...ids].flatMap(id => [
    notifee.cancelNotification(id),
    notifee.cancelTriggerNotification(id),
  ]));
}

function terminalReminderResponseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /not waiting for a response|reminder not found|occurrence is no longer active/i.test(message);
}

async function deliverReminderResponse(response: StoredReminderResponse) {
  let savedResponse = response;
  if (savedResponse.action === 'not-okay' && !savedResponse.location) {
    const location = await captureAndReportSafetyLocation(false).catch(() => null);
    if (location) {
      savedResponse = await saveReminderResponseLocation(
        savedResponse.scheduleId,
        savedResponse.occurrence,
        location,
      ) ?? {...savedResponse, location};
    }
  }
  const updated = savedResponse.action === 'not-okay'
    ? await escalateSelfCheckInNow(
        savedResponse.scheduleId,
        savedResponse.occurrence,
        savedResponse.location,
      )
    : await acknowledgeSelfCheckIn(savedResponse.scheduleId, savedResponse.occurrence);
  await completeReminderResponse(savedResponse.scheduleId, savedResponse.occurrence);
  return updated;
}

async function deliverReminderResponseWithRetry(response: StoredReminderResponse) {
  let lastError: unknown;
  for (const delay of RESPONSE_RETRY_DELAYS_MS) {
    if (delay) await new Promise<void>(resolve => setTimeout(resolve, delay));
    try {
      return await deliverReminderResponse(response);
    } catch (error) {
      if (terminalReminderResponseError(error)) {
        await completeReminderResponse(response.scheduleId, response.occurrence);
        return null;
      }
      lastError = error;
    }
  }
  throw lastError;
}

function deliverReminderResponseOnce(response: StoredReminderResponse) {
  const key = `${response.scheduleId}:${response.occurrence}`;
  const existing = reminderResponseDeliveries.get(key);
  if (existing) return existing;
  const operation = deliverReminderResponseWithRetry(response);
  reminderResponseDeliveries.set(key, operation);
  operation.finally(() => {
    if (reminderResponseDeliveries.get(key) === operation) {
      reminderResponseDeliveries.delete(key);
    }
  }).catch(() => undefined);
  return operation;
}

export async function retryPendingReminderResponses() {
  let latest: SelfCheckInSchedule | null = null;
  for (const response of await readPendingReminderResponses()) {
    try {
      latest = await deliverReminderResponseOnce(response) ?? latest;
    } catch {
      // Keep the response in the durable outbox for the next app or push wake-up.
    }
  }
  return latest;
}

export async function processPendingNativeReminderActions() {
  if (Platform.OS !== 'android') return null;
  const consume = androidAlarm()?.consumePendingActions;
  if (!consume) return null;
  let latest: SelfCheckInSchedule | null = null;
  for (const value of await consume()) {
    if (
      !value?.scheduleId ||
      !Number.isFinite(Number(value.occurrence)) ||
      (value.action !== 'okay' && value.action !== 'not-okay')
    ) continue;
    latest = await respondToReminder(
      value.scheduleId,
      value.occurrence,
      value.action,
    ) ?? latest;
  }
  return latest;
}

export async function respondToReminder(
  scheduleId: string,
  occurrence: string | number,
  action: ReminderResponseAction,
  currentNotificationId?: string,
) {
  const occurrenceKey = String(occurrence);
  if (!scheduleId || !Number.isFinite(Number(occurrenceKey))) {
    throw new Error('This reminder occurrence is invalid');
  }
  const key = `${scheduleId}:${occurrenceKey}`;
  const existing = reminderResponseSubmissions.get(key);
  if (existing) return existing;
  const operation = (async () => {
    stopAndroidAlert();
    const response = await rememberReminderResponse(scheduleId, occurrenceKey, action);
    await cancelOccurrenceNotifications(scheduleId, occurrenceKey, currentNotificationId);
    return deliverReminderResponseOnce(response);
  })();
  reminderResponseSubmissions.set(key, operation);
  try {
    return await operation;
  } finally {
    if (reminderResponseSubmissions.get(key) === operation) {
      reminderResponseSubmissions.delete(key);
    }
  }
}

export async function handleReminderEvent(event: Event) {
  const {detail, type} = event;
  if (
    type === EventType.DELIVERED
  ) {
    const deliveredScheduleId = detail.notification?.data?.scheduleId;
    const deliveredOccurrence = detail.notification?.data?.occurrence;
    if (
      typeof deliveredScheduleId === 'string' &&
      typeof deliveredOccurrence === 'string' &&
      await hasHandledReminderOccurrence(deliveredScheduleId, deliveredOccurrence)
    ) {
      stopAndroidAlert();
      await cancelOccurrenceNotifications(
        deliveredScheduleId,
        deliveredOccurrence,
        detail.notification?.id,
      );
      await retryPendingReminderResponses();
      return null;
    }
    const deliveredNotificationId = detail.notification?.id;
    const alertKey = typeof deliveredNotificationId === 'string'
      ? deliveredNotificationId
      : `${String(deliveredScheduleId ?? '')}:${String(deliveredOccurrence ?? '')}:${String(detail.notification?.data?.stage ?? '')}`;
    startAndroidAlert(
      detail.notification?.data?.sound === 'true',
      detail.notification?.data?.vibrate === 'true',
      alertKey,
      typeof deliveredNotificationId === 'string' ? deliveredNotificationId : alertKey,
      String(deliveredScheduleId ?? ''),
      String(deliveredOccurrence ?? ''),
      detail.notification?.data?.stage === '2' ? 2 : 1,
    );
    if (detail.notification?.data?.stage === '2' && Platform.OS !== 'android') {
      await captureAndReportSafetyLocation(false);
    }
    return null;
  }
  const action = detail.pressAction?.id;
  if (
    type !== EventType.ACTION_PRESS ||
    (action !== 'dindin-okay' && action !== 'dindin-not-okay')
  ) {
    return null;
  }
  const scheduleId = detail.notification?.data?.scheduleId;
  if (typeof scheduleId !== 'string') return null;
  const occurrence = detail.notification?.data?.occurrence;
  if (typeof occurrence !== 'string') return null;
  return respondToReminder(
    scheduleId,
    occurrence,
    action === 'dindin-not-okay' ? 'not-okay' : 'okay',
    detail.notification?.id,
  );
}

export async function handleReminderBackgroundEvent(event: Event) {
  try {
    await handleReminderEvent(event);
  } catch {
    // The durable response outbox retries on the next app or push wake-up.
  }
}

export async function stopActiveReminderAlert() {
  stopAndroidAlert();
  const displayed = await notifee.getDisplayedNotifications();
  const ids = displayed
    .map(item => item.notification.id)
    .filter((id): id is string => Boolean(id?.startsWith(NOTIFICATION_PREFIX)));
  await Promise.all(ids.map(id => notifee.cancelNotification(id)));
}

export function clearNativeSafetyLocationConfiguration() {
  if (Platform.OS === 'android') androidAlarm()?.clearSafetyLocationConfiguration?.();
  if (Platform.OS === 'ios') iosSafetyLocation()?.clearConfiguration();
}

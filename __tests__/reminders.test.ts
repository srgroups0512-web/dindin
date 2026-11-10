import notifee, {EventType} from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from '@react-native-community/geolocation';
import {NativeModules, Platform} from 'react-native';
import {
  displayRemoteReminder,
  handleReminderEvent,
  processPendingNativeReminderActions,
  reminderOccurrences,
  respondToReminder,
  syncReminderNotifications,
} from '../src/services/reminders';
import type {AppPreferences, SelfCheckInSchedule} from '../src/models';

const mockedNotifee = notifee as jest.Mocked<typeof notifee>;
const mockedStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const testPlatform = Platform.OS;

function schedule(overrides: Partial<SelfCheckInSchedule> = {}): SelfCheckInSchedule {
  const next = new Date(Date.now() + 60 * 60_000);
  const nextIst = new Date(next.getTime() + 330 * 60_000);
  const time = `${String(nextIst.getUTCHours()).padStart(2, '0')}:${String(nextIst.getUTCMinutes()).padStart(2, '0')}`;
  const weekdays = [nextIst.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6];
  return {
    id: 'schedule-action-test',
    times: [time],
    weekdays,
    reminders: [{id: 'reminder-1', time, weekdays}],
    timezone: 'Asia/Kolkata',
    nextRunAt: next.toISOString(),
    status: 'scheduled',
    stage: 0,
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedStorage.getItem.mockResolvedValue(null);
  NativeModules.DinDinAlarm = {
    startAlert: jest.fn(),
    stopAlert: jest.fn(),
    replaceScheduledAlerts: jest.fn(),
    cancelScheduledAlerts: jest.fn(),
    cancelOccurrence: jest.fn(),
    wasAlertDeliveredRecently: jest.fn().mockResolvedValue(false),
    consumePendingActions: jest.fn().mockResolvedValue([]),
  };
});

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', {configurable: true, value: 'android'});
});

afterAll(() => {
  delete NativeModules.DinDinAlarm;
  Object.defineProperty(Platform, 'OS', {configurable: true, value: testPlatform});
});

test('scheduled reminders expose Yes and No notification actions', async () => {
  const activeSchedule = schedule();
  const preferences: AppPreferences = {
    notifications: true,
    sounds: false,
    vibration: true,
    safetyLocation: true,
  };

  await syncReminderNotifications(activeSchedule, preferences);

  expect(mockedNotifee.createTriggerNotification).toHaveBeenCalled();
  const notification = mockedNotifee.createTriggerNotification.mock.calls[0][0];
  expect(notification.android?.channelId).toBe('dindin-self-checkin-actions-v3');
  expect(notification.android?.actions?.map(action => action.pressAction.id)).toEqual([
    'dindin-okay',
    'dindin-not-okay',
  ]);
  expect(notification.android?.timeoutAfter).toBe(60_000);
  expect(notification.android?.smallIcon).toBe('ic_stat_dindin');
  expect(notification.android?.largeIcon).toBe('ic_launcher');
  expect(NativeModules.DinDinAlarm.replaceScheduledAlerts).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        notificationId: expect.stringContaining('-1'),
        sound: false,
        vibration: true,
        durationMs: 60_000,
      }),
    ]),
  );
});

test('a handled occurrence suppresses a delayed Firebase copy', async () => {
  mockedStorage.getItem.mockImplementation(async key => key === '@dindin/reminder-responses'
    ? JSON.stringify([{
        scheduleId: 'schedule-action-test',
        occurrence: '1793004240000',
        action: 'okay',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }])
    : null);

  await displayRemoteReminder({
    type: 'dindin-reminder',
    scheduleId: 'schedule-action-test',
    occurrence: '1793004240000',
    stage: '1',
  });

  expect(mockedNotifee.displayNotification).not.toHaveBeenCalled();
  expect(mockedNotifee.cancelNotification).toHaveBeenCalledTimes(2);
  expect(mockedNotifee.cancelTriggerNotification).toHaveBeenCalledTimes(2);
});

test('a locally delivered native alarm suppresses its delayed Firebase copy', async () => {
  const wasAlertDeliveredRecently = jest.fn().mockResolvedValue(true);
  NativeModules.DinDinAlarm = {
    ...NativeModules.DinDinAlarm,
    wasAlertDeliveredRecently,
  };

  await displayRemoteReminder({
    type: 'dindin-reminder',
    scheduleId: 'schedule-action-test',
    occurrence: '1793004240000',
    stage: '1',
  });

  const expectedId = 'dindin-self-checkin-schedule-action-test-1793004240000-1';
  expect(wasAlertDeliveredRecently).toHaveBeenCalledWith(expectedId);
  expect(mockedNotifee.displayNotification).not.toHaveBeenCalled();
  expect(mockedNotifee.cancelNotification).toHaveBeenCalledWith(expectedId);
});

test('responding immediately cancels both displayed and pending copies', async () => {
  const values = new Map<string, string>([[
    '@dindin/auth',
    JSON.stringify({
      userId: 'user-1',
      token: 'valid-token',
      phone: '+919999999999',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  ]]);
  mockedStorage.getItem.mockImplementation(async key => values.get(key) ?? null);
  mockedStorage.setItem.mockImplementation(async (key, value) => {
    values.set(key, value);
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({schedule: schedule({status: 'safe', stage: 0})}),
  })) as jest.Mock;
  try {
    await respondToReminder(
      'schedule-action-test',
      '1793004240000',
      'okay',
      'visible-notification',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(mockedNotifee.cancelNotification).toHaveBeenCalledTimes(3);
  expect(mockedNotifee.cancelTriggerNotification).toHaveBeenCalledTimes(3);
  const stored = JSON.parse(values.get('@dindin/reminder-responses') ?? '[]');
  expect(stored).toEqual([expect.objectContaining({
    scheduleId: 'schedule-action-test',
    occurrence: '1793004240000',
    action: 'okay',
    completedAt: expect.any(String),
  })]);
});

test('simultaneous response paths submit one request for the occurrence', async () => {
  const values = new Map<string, string>([[
    '@dindin/auth',
    JSON.stringify({
      userId: 'user-1',
      token: 'valid-token',
      phone: '+919999999999',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  ]]);
  mockedStorage.getItem.mockImplementation(async key => values.get(key) ?? null);
  mockedStorage.setItem.mockImplementation(async (key, value) => {
    values.set(key, value);
  });
  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({schedule: schedule({status: 'safe', stage: 0})}),
  })) as jest.Mock;
  globalThis.fetch = fetchMock;
  try {
    const occurrence = '1793004240000';
    const [first, second] = await Promise.all([
      respondToReminder('schedule-action-test', occurrence, 'okay', 'notification-one'),
      respondToReminder('schedule-action-test', occurrence, 'okay', 'notification-two'),
    ]);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('each exact clock reminder runs only on its own selected weekdays', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-26T00:00:00.000Z'));
  try {
    const activeSchedule = schedule({
      reminders: [
        {id: 'morning', time: '06:00', weekdays: [1, 3]},
        {id: 'later', time: '08:00', weekdays: [1]},
        {id: 'evening', time: '20:00', weekdays: [3]},
      ],
      nextRunAt: '2026-10-26T00:30:00.000Z',
    });
    const values = reminderOccurrences(activeSchedule, 5);
    expect(values.map(value => new Date(value).toISOString())).toEqual([
      '2026-10-26T00:30:00.000Z',
      '2026-10-26T02:30:00.000Z',
      '2026-10-28T00:30:00.000Z',
      '2026-10-28T14:30:00.000Z',
      '2026-11-02T00:30:00.000Z',
    ]);
  } finally {
    jest.useRealTimers();
  }
});

test('reopening during the first response window preserves the second alert', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-26T12:05:00.000Z'));
  try {
    const occurrence = new Date('2026-10-26T12:00:00.000Z').getTime();
    await syncReminderNotifications(schedule({
      nextRunAt: new Date(occurrence).toISOString(),
      status: 'waiting-first',
      stage: 1,
      reminders: [{id: 'evening', time: '17:30', weekdays: [1]}],
    }), {
      notifications: true,
      sounds: true,
      vibration: true,
      safetyLocation: true,
    });

    expect(mockedNotifee.createTriggerNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `dindin-self-checkin-schedule-action-test-${occurrence}-2`,
      }),
      expect.objectContaining({timestamp: occurrence + 10 * 60_000}),
    );
    expect(NativeModules.DinDinAlarm.replaceScheduledAlerts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          notificationId: `dindin-self-checkin-schedule-action-test-${occurrence}-2`,
          timestamp: occurrence + 10 * 60_000,
        }),
      ]),
    );
  } finally {
    jest.useRealTimers();
  }
});

test.each([
  [true, true],
  [true, false],
  [false, true],
  [false, false],
])('sound %s and vibration %s are preserved for the native alert', async (sounds, vibration) => {
  await syncReminderNotifications(schedule(), {
    notifications: true,
    sounds,
    vibration,
    safetyLocation: true,
  });
  const notification = mockedNotifee.createTriggerNotification.mock.calls[0][0];
  expect(notification.android?.channelId).toBe('dindin-self-checkin-actions-v3');
  expect(notification.android?.loopSound).toBe(false);
  expect(Object.hasOwn(notification.android || {}, 'vibrationPattern')).toBe(false);
  expect(notification.data?.sound).toBe(String(sounds));
  expect(notification.data?.vibrate).toBe(String(vibration));
  expect(Object.hasOwn(notification.ios || {}, 'sound')).toBe(sounds);
  expect(NativeModules.DinDinAlarm.replaceScheduledAlerts).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({sound: sounds, vibration}),
    ]),
  );
});

test('a delivered Android reminder starts the native one-minute alarm', async () => {
  const originalPlatform = Platform.OS;
  const startAlert = jest.fn();
  const stopAlert = jest.fn();
  Object.defineProperty(Platform, 'OS', {configurable: true, value: 'android'});
  NativeModules.DinDinAlarm = {startAlert, stopAlert};
  try {
    await handleReminderEvent({
      type: EventType.DELIVERED,
      detail: {
        notification: {
          id: 'dindin-self-checkin-schedule-action-test-1793004240000-1',
          data: {
            scheduleId: 'schedule-action-test',
            occurrence: '1793004240000',
            stage: '1',
            sound: 'true',
            vibrate: 'true',
          },
        },
      },
    });
    expect(startAlert).toHaveBeenCalledWith(
      true,
      true,
      60_000,
      'dindin-self-checkin-schedule-action-test-1793004240000-1',
      'dindin-self-checkin-schedule-action-test-1793004240000-1',
      'schedule-action-test',
      '1793004240000',
      1,
    );
  } finally {
    delete NativeModules.DinDinAlarm;
    Object.defineProperty(Platform, 'OS', {configurable: true, value: originalPlatform});
  }
});

test('a native notification action is delivered through the durable response flow', async () => {
  const values = new Map<string, string>([[
    '@dindin/auth',
    JSON.stringify({
      userId: 'user-1',
      token: 'valid-token',
      phone: '+919999999999',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  ]]);
  mockedStorage.getItem.mockImplementation(async key => values.get(key) ?? null);
  mockedStorage.setItem.mockImplementation(async (key, value) => {
    values.set(key, value);
  });
  NativeModules.DinDinAlarm.consumePendingActions = jest.fn().mockResolvedValue([{
    scheduleId: 'schedule-action-test',
    occurrence: '1793004240000',
    action: 'okay',
  }]);
  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({schedule: schedule({status: 'safe', stage: 0})}),
  })) as jest.Mock;
  globalThis.fetch = fetchMock;
  try {
    const updated = await processPendingNativeReminderActions();
    expect(updated?.status).toBe('safe');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/self-check-in/acknowledge');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the second native alert starts before its location lookup completes', async () => {
  const originalPlatform = Platform.OS;
  const startAlert = jest.fn();
  let resolveLocation: ((position: {
    coords: {latitude: number; longitude: number; accuracy: number};
    timestamp: number;
  }) => void) | undefined;
  Object.defineProperty(Platform, 'OS', {configurable: true, value: 'android'});
  NativeModules.DinDinAlarm = {
    ...NativeModules.DinDinAlarm,
    startAlert,
  };
  jest.mocked(Geolocation.getCurrentPosition).mockImplementationOnce(success => {
    resolveLocation = success as typeof resolveLocation;
  });
  try {
    const eventPromise = handleReminderEvent({
      type: EventType.DELIVERED,
      detail: {
        notification: {
          id: 'dindin-self-checkin-schedule-action-test-1793004240000-2',
          data: {
            scheduleId: 'schedule-action-test',
            occurrence: '1793004240000',
            stage: '2',
            sound: 'true',
            vibrate: 'true',
          },
        },
      },
    });
    await new Promise<void>(resolve => setImmediate(() => resolve()));
    expect(startAlert).toHaveBeenCalledTimes(1);
    resolveLocation?.({
      coords: {latitude: 22.7196, longitude: 75.8577, accuracy: 10},
      timestamp: Date.now(),
    });
    await eventPromise;
  } finally {
    Object.defineProperty(Platform, 'OS', {configurable: true, value: originalPlatform});
  }
});

test.each([
  [false, true],
  [true, false],
])('no notifications are scheduled when enabled=%s and schedule active=%s', async (notifications, active) => {
  await syncReminderNotifications(schedule({active}), {
    notifications,
    sounds: true,
    vibration: true,
    safetyLocation: true,
  });
  expect(mockedNotifee.createTriggerNotification).not.toHaveBeenCalled();
  expect(NativeModules.DinDinAlarm.cancelScheduledAlerts).toHaveBeenCalled();
});

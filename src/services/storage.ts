import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  defaultPreferences,
  type AppPreferences,
  type EmergencyContact,
  type SafetyLocation,
  type SelfCheckInSchedule,
} from '../models';

const KEYS = {
  session: '@dindin/session',
  subscription: '@dindin/subscription',
  subscriptionPreview: '@dindin/subscription-preview',
  profile: '@dindin/profile',
  preferences: '@dindin/preferences',
  auth: '@dindin/auth',
  contacts: '@dindin/contacts',
  selfSchedule: '@dindin/self-schedule',
  safetySetup: '@dindin/safety-setup',
  safetyLocation: '@dindin/safety-location',
  reminderResponses: '@dindin/reminder-responses',
  legacyRelatives: '@dindin/relatives',
};

export type ReminderResponseAction = 'okay' | 'not-okay';

export type StoredReminderResponse = {
  scheduleId: string;
  occurrence: string;
  action: ReminderResponseAction;
  createdAt: string;
  completedAt?: string;
  location?: SafetyLocation;
};

const REMINDER_RESPONSE_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_REMINDER_RESPONSES = 200;
let reminderResponseMutation: Promise<unknown> = Promise.resolve();

function reminderResponseKey(scheduleId: string, occurrence: string) {
  return `${scheduleId}:${occurrence}`;
}

function validReminderResponses(value: string | null): StoredReminderResponse[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as StoredReminderResponse[];
    if (!Array.isArray(parsed)) return [];
    const oldest = Date.now() - REMINDER_RESPONSE_RETENTION_MS;
    return parsed.filter(item =>
      typeof item?.scheduleId === 'string' &&
      typeof item?.occurrence === 'string' &&
      (item.action === 'okay' || item.action === 'not-okay') &&
      Number.isFinite(new Date(item.createdAt).getTime()) &&
      new Date(item.createdAt).getTime() >= oldest
    ).slice(-MAX_REMINDER_RESPONSES);
  } catch {
    return [];
  }
}

async function readReminderResponsesUnsafe(): Promise<StoredReminderResponse[]> {
  return validReminderResponses(await AsyncStorage.getItem(KEYS.reminderResponses));
}

function mutateReminderResponses<T>(operation: () => Promise<T>): Promise<T> {
  const result = reminderResponseMutation.then(operation, operation);
  reminderResponseMutation = result.then(() => undefined, () => undefined);
  return result;
}

async function writeReminderResponses(items: StoredReminderResponse[]) {
  await AsyncStorage.setItem(
    KEYS.reminderResponses,
    JSON.stringify(items.slice(-MAX_REMINDER_RESPONSES)),
  );
}

export type StoredAuthSession = {
  userId: string;
  token: string;
  phone: string;
  expiresAt: string;
};

export async function readSession(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.session)) === 'registered';
}

export async function saveSession(): Promise<void> {
  await AsyncStorage.setItem(KEYS.session, 'registered');
}

export async function readProfile(): Promise<string> {
  return (await AsyncStorage.getItem(KEYS.profile)) ?? '';
}

export async function saveProfile(name: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.profile, name);
}

export async function readAuthSession(): Promise<StoredAuthSession | null> {
  const value = await AsyncStorage.getItem(KEYS.auth);
  if (!value) return null;
  try {
    const session = JSON.parse(value) as StoredAuthSession;
    if (!session.userId || !session.token || new Date(session.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function saveAuthSession(session: StoredAuthSession): Promise<void> {
  await AsyncStorage.setItem(KEYS.auth, JSON.stringify(session));
}

export async function readSubscription(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.subscription)) === 'active';
}

export async function saveSubscription(): Promise<void> {
  await AsyncStorage.setItem(KEYS.subscription, 'active');
}

export async function clearSubscription(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.subscription);
}

export async function readSubscriptionPreview(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.subscriptionPreview)) === 'active';
}

export async function saveSubscriptionPreview(): Promise<void> {
  await AsyncStorage.setItem(KEYS.subscriptionPreview, 'active');
}

export async function clearSubscriptionPreview(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.subscriptionPreview);
}

export async function readContacts(): Promise<EmergencyContact[]> {
  const value = await AsyncStorage.getItem(KEYS.contacts);
  if (!value) return [];
  try {
    return JSON.parse(value) as EmergencyContact[];
  } catch {
    return [];
  }
}

export async function saveContacts(contacts: EmergencyContact[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.contacts, JSON.stringify(contacts));
}

export async function readSelfSchedule(): Promise<SelfCheckInSchedule | null> {
  const value = await AsyncStorage.getItem(KEYS.selfSchedule);
  if (!value) return null;
  try {
    return JSON.parse(value) as SelfCheckInSchedule;
  } catch {
    return null;
  }
}

export async function saveSelfSchedule(schedule: SelfCheckInSchedule | null): Promise<void> {
  if (!schedule) {
    await AsyncStorage.removeItem(KEYS.selfSchedule);
    return;
  }
  await AsyncStorage.setItem(KEYS.selfSchedule, JSON.stringify(schedule));
}

export async function readPreferences(): Promise<AppPreferences> {
  const value = await AsyncStorage.getItem(KEYS.preferences);
  if (!value) return defaultPreferences;
  try {
    const stored = JSON.parse(value) as Partial<AppPreferences>;
    return {
      notifications: stored.notifications !== false,
      sounds: stored.sounds !== false,
      vibration: stored.vibration !== false,
      safetyLocation: stored.safetyLocation === true,
    };
  } catch {
    return defaultPreferences;
  }
}

export async function readSafetySetup(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.safetySetup)) === 'complete';
}

export async function saveSafetySetup(): Promise<void> {
  await AsyncStorage.setItem(KEYS.safetySetup, 'complete');
}

export async function readSafetyLocation(): Promise<SafetyLocation | null> {
  const value = await AsyncStorage.getItem(KEYS.safetyLocation);
  if (!value) return null;
  try {
    return JSON.parse(value) as SafetyLocation;
  } catch {
    return null;
  }
}

export async function saveSafetyLocation(location: SafetyLocation): Promise<void> {
  await AsyncStorage.setItem(KEYS.safetyLocation, JSON.stringify(location));
}

export async function savePreferences(preferences: AppPreferences): Promise<void> {
  await AsyncStorage.setItem(KEYS.preferences, JSON.stringify(preferences));
}

export async function rememberReminderResponse(
  scheduleId: string,
  occurrence: string,
  action: ReminderResponseAction,
): Promise<StoredReminderResponse> {
  return mutateReminderResponses(async () => {
    const items = await readReminderResponsesUnsafe();
    const key = reminderResponseKey(scheduleId, occurrence);
    const existing = items.find(item =>
      reminderResponseKey(item.scheduleId, item.occurrence) === key
    );
    if (existing) return existing;
    const response: StoredReminderResponse = {
      scheduleId,
      occurrence,
      action,
      createdAt: new Date().toISOString(),
    };
    await writeReminderResponses([...items, response]);
    return response;
  });
}

export async function saveReminderResponseLocation(
  scheduleId: string,
  occurrence: string,
  location: SafetyLocation,
): Promise<StoredReminderResponse | null> {
  return mutateReminderResponses(async () => {
    const items = await readReminderResponsesUnsafe();
    const key = reminderResponseKey(scheduleId, occurrence);
    const index = items.findIndex(item =>
      reminderResponseKey(item.scheduleId, item.occurrence) === key
    );
    if (index < 0) return null;
    const updated = {...items[index], location};
    items[index] = updated;
    await writeReminderResponses(items);
    return updated;
  });
}

export async function completeReminderResponse(
  scheduleId: string,
  occurrence: string,
): Promise<void> {
  await mutateReminderResponses(async () => {
    const items = await readReminderResponsesUnsafe();
    const key = reminderResponseKey(scheduleId, occurrence);
    const index = items.findIndex(item =>
      reminderResponseKey(item.scheduleId, item.occurrence) === key
    );
    if (index < 0 || items[index].completedAt) return;
    items[index] = {...items[index], completedAt: new Date().toISOString()};
    await writeReminderResponses(items);
  });
}

export async function hasHandledReminderOccurrence(
  scheduleId: string,
  occurrence: string,
): Promise<boolean> {
  await reminderResponseMutation;
  const key = reminderResponseKey(scheduleId, occurrence);
  return (await readReminderResponsesUnsafe()).some(item =>
    reminderResponseKey(item.scheduleId, item.occurrence) === key
  );
}

export async function readPendingReminderResponses(): Promise<StoredReminderResponse[]> {
  await reminderResponseMutation;
  return (await readReminderResponsesUnsafe()).filter(item => !item.completedAt);
}

export async function clearLocalData(): Promise<void> {
  await AsyncStorage.removeMany(Object.values(KEYS));
}

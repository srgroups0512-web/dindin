import {Platform} from 'react-native';
import {DEVELOPMENT_PREVIEW_ENABLED} from '../config';
import type {
  AppPreferences,
  BillingEntitlement,
  DraftContact,
  EmergencyContact,
  FamilyPlan,
  ReminderScheduleValues,
  SafetyLocation,
  SelfCheckInSchedule,
} from '../models';
import {readAuthSession, readSubscriptionPreview, type StoredAuthSession} from './storage';

export const API_BASE_URL = 'https://api.dindin.info';

type RegistrationResponse = {
  user: {id: string; phone: string; name: string};
  token: string;
  expiresAt: string;
};

async function readJson<T>(response: Response): Promise<T & {error?: string}> {
  return (await response.json()) as T & {error?: string};
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  const session = await readAuthSession();
  if (!session) throw new Error('Your session has expired. Please register again.');
  const developmentPreview = DEVELOPMENT_PREVIEW_ENABLED && await readSubscriptionPreview();
  return {
    Authorization: `Bearer ${session.token}`,
    ...(developmentPreview ? {'X-DinDin-Development-Preview': 'true'} : {}),
    ...(json ? {'Content-Type': 'application/json'} : {}),
  };
}

export async function requestRegistrationOtp(phone: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/auth/request-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({phone}),
  });
  const result = await readJson<{}>(response);
  if (!response.ok) throw new Error(result.error || `Could not send verification code (${response.status})`);
}

export async function verifyOtpRegistration(
  name: string,
  phone: string,
  otp: string,
): Promise<StoredAuthSession> {
  const response = await fetch(`${API_BASE_URL}/v1/auth/verify-otp`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({name, phone, otp}),
  });
  const result = await readJson<RegistrationResponse>(response);
  if (!response.ok) throw new Error(result.error || `Verification failed (${response.status})`);
  return {
    userId: result.user.id,
    token: result.token,
    phone: result.user.phone,
    expiresAt: result.expiresAt,
  };
}

export async function fetchContacts(): Promise<EmergencyContact[]> {
  const response = await fetch(`${API_BASE_URL}/v1/contacts`, {headers: await authHeaders()});
  const result = await readJson<{items?: EmergencyContact[]}>(response);
  if (!response.ok) throw new Error(result.error || `Could not load your circle (${response.status})`);
  return result.items ?? [];
}

export async function createContact(contact: DraftContact): Promise<EmergencyContact> {
  const response = await fetch(`${API_BASE_URL}/v1/contacts`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify(contact),
  });
  const result = await readJson<{contact: EmergencyContact}>(response);
  if (!response.ok) throw new Error(result.error || `Could not add contact (${response.status})`);
  return result.contact;
}

export async function updateContact(
  id: string,
  changes: Partial<Pick<EmergencyContact, 'name' | 'relationship' | 'phone' | 'primary'>>,
): Promise<EmergencyContact> {
  const response = await fetch(`${API_BASE_URL}/v1/contacts/${id}`, {
    method: 'PUT',
    headers: await authHeaders(true),
    body: JSON.stringify(changes),
  });
  const result = await readJson<{contact: EmergencyContact}>(response);
  if (!response.ok) throw new Error(result.error || `Could not update contact (${response.status})`);
  return result.contact;
}

export async function deleteContact(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/contacts/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  const result = await readJson<{}>(response);
  if (!response.ok) throw new Error(result.error || `Could not remove contact (${response.status})`);
}

export async function fetchSelfCheckIn(): Promise<SelfCheckInSchedule | null> {
  const response = await fetch(`${API_BASE_URL}/v1/self-check-in`, {headers: await authHeaders()});
  const result = await readJson<{schedule: SelfCheckInSchedule | null}>(response);
  if (!response.ok) throw new Error(result.error || `Could not load reminder (${response.status})`);
  return result.schedule ?? null;
}

export async function saveSelfCheckInSchedule(values: {
  reminders: ReminderScheduleValues['reminders'];
  timezone?: string;
}): Promise<SelfCheckInSchedule> {
  const response = await fetch(`${API_BASE_URL}/v1/self-check-in`, {
    method: 'PUT',
    headers: await authHeaders(true),
    body: JSON.stringify({
      ...values,
      timezone: values.timezone || 'Asia/Kolkata',
      clientPlatform: Platform.OS,
    }),
  });
  const result = await readJson<{schedule: SelfCheckInSchedule}>(response);
  if (!response.ok) throw new Error(result.error || `Could not save reminder (${response.status})`);
  return result.schedule;
}

export async function deleteSelfCheckInSchedule(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/self-check-in`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  const result = await readJson<{}>(response);
  if (!response.ok) throw new Error(result.error || `Could not delete reminder (${response.status})`);
}

export async function setSelfCheckInActive(active: boolean): Promise<SelfCheckInSchedule> {
  const response = await fetch(`${API_BASE_URL}/v1/self-check-in/active`, {
    method: 'PUT',
    headers: await authHeaders(true),
    body: JSON.stringify({active}),
  });
  const result = await readJson<{schedule: SelfCheckInSchedule}>(response);
  if (!response.ok) throw new Error(result.error || `Could not update reminder (${response.status})`);
  return result.schedule;
}

export async function acknowledgeSelfCheckIn(
  scheduleId: string,
  occurrence: string,
): Promise<SelfCheckInSchedule> {
  const response = await fetch(`${API_BASE_URL}/v1/self-check-in/acknowledge`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({scheduleId, occurrence}),
  });
  const result = await readJson<{schedule: SelfCheckInSchedule}>(response);
  if (!response.ok) throw new Error(result.error || `Could not confirm check-in (${response.status})`);
  return result.schedule;
}

export async function reportSafetyLocation(location: SafetyLocation): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/me/safety-location`, {
    method: 'PUT',
    headers: await authHeaders(true),
    body: JSON.stringify(location),
  });
  const result = await readJson<{}>(response);
  if (!response.ok) throw new Error(result.error || `Could not save safety location (${response.status})`);
}

export async function escalateSelfCheckInNow(
  scheduleId: string,
  occurrence: string,
  location?: SafetyLocation | null,
): Promise<SelfCheckInSchedule> {
  const response = await fetch(`${API_BASE_URL}/v1/self-check-in/escalate`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({scheduleId, occurrence, location: location || undefined}),
  });
  const result = await readJson<{schedule: SelfCheckInSchedule}>(response);
  if (!response.ok) throw new Error(result.error || `Could not alert your circle (${response.status})`);
  return result.schedule;
}

export async function verifyPurchaseOnServer(payload: unknown): Promise<{
  valid: boolean;
  entitlement: BillingEntitlement;
}> {
  const response = await fetch(`${API_BASE_URL}/v1/billing/verify`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify(payload),
  });
  const result = await readJson<{valid?: boolean; entitlement?: BillingEntitlement}>(response);
  if (!response.ok || !result.entitlement) {
    throw new Error(result.error || `Purchase verification failed (${response.status})`);
  }
  return {valid: result.valid === true, entitlement: result.entitlement};
}

export async function fetchBillingEntitlement(): Promise<BillingEntitlement> {
  const response = await fetch(`${API_BASE_URL}/v1/billing/entitlement`, {
    headers: await authHeaders(),
  });
  const result = await readJson<{entitlement?: BillingEntitlement}>(response);
  if (!response.ok || !result.entitlement) {
    throw new Error(result.error || `Could not check your subscription (${response.status})`);
  }
  return result.entitlement;
}

export async function fetchFamilyPlan(): Promise<FamilyPlan> {
  const response = await fetch(`${API_BASE_URL}/v1/family`, {headers: await authHeaders()});
  const result = await readJson<{family?: FamilyPlan}>(response);
  if (!response.ok || !result.family) {
    throw new Error(result.error || `Could not load your family plan (${response.status})`);
  }
  return result.family;
}

export async function addFamilyPlanMember(phone: string): Promise<FamilyPlan> {
  const response = await fetch(`${API_BASE_URL}/v1/family/members`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({phone}),
  });
  const result = await readJson<{family?: FamilyPlan}>(response);
  if (!response.ok || !result.family) {
    throw new Error(result.error || `Could not add this family member (${response.status})`);
  }
  return result.family;
}

export async function savePreferencesOnServer(preferences: AppPreferences): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/me/preferences`, {
    method: 'PUT',
    headers: await authHeaders(true),
    body: JSON.stringify(preferences),
  });
  if (!response.ok) throw new Error(`Settings sync failed (${response.status})`);
}

export async function fetchPreferencesFromServer(): Promise<AppPreferences> {
  const response = await fetch(`${API_BASE_URL}/v1/me/preferences`, {headers: await authHeaders()});
  const result = await readJson<{preferences?: AppPreferences}>(response);
  if (!response.ok || !result.preferences) {
    throw new Error(result.error || `Settings request failed (${response.status})`);
  }
  return {
    notifications: result.preferences.notifications !== false,
    sounds: result.preferences.sounds !== false,
    vibration: result.preferences.vibration !== false,
    safetyLocation: result.preferences.safetyLocation === true,
  };
}

export async function registerPushTokenOnServer(token: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/push-tokens`, {
    method: 'POST',
    headers: await authHeaders(true),
    body: JSON.stringify({token, platform: Platform.OS}),
  });
  const result = await readJson<{}>(response);
  if (!response.ok) throw new Error(result.error || `Push registration failed (${response.status})`);
}

export async function unregisterPushTokenOnServer(token: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/push-tokens`, {
    method: 'DELETE',
    headers: await authHeaders(true),
    body: JSON.stringify({token}),
  });
  const result = await readJson<{}>(response);
  if (!response.ok) throw new Error(result.error || `Push removal failed (${response.status})`);
}

export async function deleteAccountOnServer(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/me`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!response.ok) throw new Error(`Account deletion failed (${response.status})`);
}

export async function logoutOnServer(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/auth/logout`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const result = await readJson<{}>(response);
  if (!response.ok) throw new Error(result.error || `Could not log out (${response.status})`);
}

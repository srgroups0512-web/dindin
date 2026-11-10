export type ScreenName =
  | 'welcome'
  | 'register'
  | 'otp'
  | 'subscription'
  | 'safety-setup'
  | 'home'
  | 'add-contact'
  | 'schedule'
  | 'circle'
  | 'settings'
  | 'family-members'
  | 'privacy-settings';

export type AppPreferences = {
  notifications: boolean;
  sounds: boolean;
  vibration: boolean;
  safetyLocation: boolean;
};

export const defaultPreferences: AppPreferences = {
  notifications: true,
  sounds: true,
  vibration: true,
  safetyLocation: false,
};

export type BillingEntitlement = {
  active: boolean;
  kind: 'subscription' | 'lifetime' | null;
  productId: string | null;
  basePlanId: string | null;
  status: string;
  expiresAt: string | null;
  willRenew: boolean;
  accessSource: 'direct' | 'family-member' | null;
  familyRole: 'owner' | 'member' | null;
  familyCapacity: number | null;
};

export type FamilyMember = {
  id: string;
  phone: string;
  createdAt: string;
};

export type FamilyPlan = {
  role: 'owner' | 'member' | null;
  active: boolean;
  /** Total covered accounts, including the purchaser. */
  capacity: number;
  members: FamilyMember[];
};

export type SafetyLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  capturedAt: string;
};

export type CheckInInterval = 'daily' | 'two-days' | 'weekly';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ReminderRule = {
  id: string;
  /** Exact local clock time in 24-hour HH:mm format. */
  time: string;
  /** JavaScript weekday numbers: Sunday = 0 through Saturday = 6. */
  weekdays: Weekday[];
};

export type ReminderScheduleValues = {
  reminders: ReminderRule[];
};

export type EmergencyContact = {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  primary: boolean;
};

export type DraftContact = Pick<
  EmergencyContact,
  'name' | 'relationship' | 'phone' | 'primary'
>;

export const emptyDraftContact: DraftContact = {
  name: '',
  relationship: 'Family',
  phone: '',
  primary: true,
};

export type SelfCheckInStatus =
  | 'scheduled'
  | 'waiting-first'
  | 'waiting-second'
  | 'safe'
  | 'missed'
  | 'send-failed';

export type CheckInEvent = {
  type: string;
  at: string;
};

export type SelfCheckInSchedule = {
  id: string;
  /** Kept optional so previously saved schedules can still be read during migration. */
  interval?: CheckInInterval;
  /** Legacy value retained while previously saved schedules migrate. */
  time?: string;
  /** Legacy values retained while previously saved schedules migrate. */
  times?: string[];
  weekdays?: Weekday[];
  reminders: ReminderRule[];
  timezone: string;
  nextRunAt: string;
  status: SelfCheckInStatus;
  stage: 0 | 1 | 2;
  active: boolean;
  lastResponseAt?: string;
  events?: CheckInEvent[];
};

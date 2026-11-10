import 'dotenv/config';
import http from 'node:http';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {applicationDefault, initializeApp} from 'firebase-admin/app';
import {getMessaging} from 'firebase-admin/messaging';
import {DataStore, intervalDays} from './db/store.js';
import {
  acknowledgeGooglePlayPurchase,
  googlePlayBillingMode,
  verifyGooglePlayPurchase,
} from './billing/googlePlay.js';
import {
  familyCapacityFor,
  isFamilyProduct,
  isSupportedGooglePlayProduct,
} from './billing/products.js';
import {reminderRuntimeAccess} from './reminderAccess.js';
import {
  sendCallPermissionTemplate,
  sendSafetyAlertReminderTemplate,
  sendSafetyLocationTemplate,
  sendUserRequestedHelpTemplate,
  sendMissedCheckInTemplate,
  whatsappConfigured,
  WHATSAPP_TEMPLATES,
} from './whatsapp.js';
import {
  createSafetyAlertToken,
  renderExpiredSafetyAlertPage,
  renderSafetyAlertPage,
  verifySafetyAlertToken,
} from './safetyAlerts.js';
import {parseTechiesQuickReply} from './techiesWebhook.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const IST_OFFSET_MINUTES = 330;
const SESSION_DAYS = 90;
const OTP_EXPIRY_MINUTES = 10;
const OTP_REQUEST_COOLDOWN_MS = 60_000;
const OTP_MAX_REQUESTS_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;
const BILLING_REFRESH_INTERVAL_MS = 15 * 60_000;
const SAFETY_ALERT_RETRY_MS = 2 * 60_000;
const SAFETY_ALERT_EXPIRY_MS = 24 * 60 * 60_000;
const SAFETY_LOCATION_MAX_AGE_MS = 5 * 60_000;
const store = new DataStore();
const checkIns = new Map();
const timers = new Map();
const selfCheckIns = new Map();
const selfTimers = new Map();
const safetyAlertTimers = new Map();
const safetyEscalations = new Map();
let pushMessaging = null;
let pushInitializationError = null;

if (
  process.env.NODE_ENV !== 'test' &&
  process.env.FIREBASE_PROJECT_ID &&
  process.env.GOOGLE_APPLICATION_CREDENTIALS
) {
  try {
    const firebaseApp = initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    pushMessaging = getMessaging(firebaseApp);
  } catch (error) {
    pushInitializationError = error;
  }
}

function json(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-DinDin-Development-Preview',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

function html(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'Content-Security-Policy': "default-src 'none'; img-src https://dindin.info; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  response.end(payload);
}

async function body(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new HttpError(413, 'Request body is too large');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function normalizePhone(value = '', defaultCountryCode = '91') {
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  return `+${digits}`;
}

function parseSafetyLocation(input = {}) {
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const accuracy = input.accuracy == null ? undefined : Number(input.accuracy);
  const capturedAt = new Date(input.capturedAt || Date.now());
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0)) ||
    Number.isNaN(capturedAt.getTime())
  ) {
    throw new HttpError(400, 'A valid safety location is required');
  }
  return {
    latitude,
    longitude,
    accuracy,
    capturedAt: capturedAt.toISOString(),
  };
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hasOtpProvider() {
  if (process.env.NODE_ENV === 'test' && process.env.OTP_PROVIDER === 'test') return true;
  return process.env.OTP_PROVIDER === 'obligr' && Boolean(
    process.env.OBLIGR_API_KEY && process.env.OTP_HASH_SECRET,
  );
}

function otpHash(phone, code) {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret) throw new HttpError(503, 'Mobile verification is temporarily unavailable');
  return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
}

function playReviewerOtp(phone) {
  const reviewerPhone = normalizePhone(process.env.PLAY_REVIEW_PHONE || '');
  const reviewerOtp = String(process.env.PLAY_REVIEW_OTP || '');
  if (!/^\+\d{10,15}$/.test(reviewerPhone) || !/^\d{6}$/.test(reviewerOtp)) return null;
  return phone === reviewerPhone ? reviewerOtp : null;
}

async function sendOtpMessage(phone, code) {
  if (process.env.NODE_ENV === 'test' && process.env.OTP_PROVIDER === 'test') return;
  if (!hasOtpProvider()) throw new HttpError(503, 'Mobile verification is temporarily unavailable');

  const endpoint = new URL(process.env.OBLIGR_OTP_ENDPOINT || 'https://obligr.io/api_v2/message/send');
  const template = process.env.OTP_MESSAGE_TEMPLATE ||
    'Your OTP for mobile number verification on Din Din is {OTP}. It is valid for 10 minutes. Do not share this OTP with anyone.';
  endpoint.searchParams.set('api_key', process.env.OBLIGR_API_KEY);
  endpoint.searchParams.set('mobile_no', phone.startsWith('+91') ? phone.slice(3) : phone.slice(1));
  endpoint.searchParams.set('message', template.replaceAll('{OTP}', code));

  let providerResponse;
  try {
    providerResponse = await fetch(endpoint, {
      headers: {Accept: 'application/json'},
      signal: globalThis.AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, 'Verification message could not be sent. Please try again.');
  }
  const responseText = await providerResponse.text();
  let providerResult;
  try {
    providerResult = JSON.parse(responseText);
  } catch {
    providerResult = null;
  }
  const providerStatus = String(providerResult?.status ?? '').toLowerCase();
  const explicitlyFailed = ['error', 'failed', 'failure', 'false'].includes(providerStatus) ||
    providerResult?.success === false;
  if (!providerResponse.ok || explicitlyFailed) {
    throw new HttpError(502, 'Verification message could not be sent. Please try again.');
  }
}

function hasWhatsAppCredentials() {
  return whatsappConfigured();
}

function pushMode() {
  if (pushInitializationError) return 'error';
  return pushMessaging ? 'configured' : 'not-configured';
}

function secureValueMatches(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length > 0 && leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function billingTokenKey() {
  const secret = process.env.BILLING_TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new HttpError(503, 'Billing token protection is not configured');
  return createHash('sha256').update(secret).digest();
}

function encryptBillingToken(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', billingTokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptBillingToken(value) {
  const [version, ivValue, tagValue, encryptedValue] = String(value || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('Stored billing token is invalid');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    billingTokenKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

async function verifyAndStoreGooglePurchase(userId, input) {
  const platform = String(input.platform || '').toLowerCase();
  const purchase = input.purchase && typeof input.purchase === 'object'
    ? input.purchase
    : input;
  const productId = String(purchase.productId || '').trim();
  const purchaseToken = String(purchase.purchaseToken || '').trim();
  if (platform !== 'android') {
    throw new HttpError(400, 'Only Google Play purchases are available in this build');
  }
  if (!isSupportedGooglePlayProduct(productId) || purchaseToken.length < 8) {
    throw new HttpError(400, 'A valid Google Play purchase is required');
  }

  let verification;
  try {
    verification = await verifyGooglePlayPurchase({productId, purchaseToken, userId});
  } catch (error) {
    if ([401, 403].includes(Number(error.status))) {
      throw new HttpError(503, 'Google Play verification is temporarily unavailable');
    }
    throw error;
  }
  if (!verification.valid) return {valid: false, entitlement: await store.getBillingEntitlement(userId)};
  if (verification.accountId && verification.accountId !== userId) {
    throw new HttpError(403, 'This purchase belongs to a different Din Din account');
  }

  const familyCapacity = familyCapacityFor(verification.productId, verification.basePlanId);
  if (isFamilyProduct(verification.productId)) {
    if (!familyCapacity) throw new HttpError(400, 'This Din Din family plan is not supported');
    const assignedMembers = await store.listFamilyMembers(userId);
    if (assignedMembers.length + 1 > familyCapacity) {
      throw new HttpError(
        409,
        `This plan covers ${familyCapacity} accounts, but ${assignedMembers.length + 1} family accounts are permanently assigned. Choose a larger plan.`,
      );
    }
  }

  try {
    if (verification.originalTransactionId) {
      await store.setBillingPurchaseStatus(hash(verification.originalTransactionId), 'expired');
    }
    await store.upsertBillingPurchase(userId, {
      platform: 'android',
      purchaseType: verification.purchaseType,
      productId: verification.productId,
      basePlanId: verification.basePlanId,
      status: verification.status,
      storeTransactionId: verification.transactionId || `google-${hash(purchaseToken).slice(0, 32)}`,
      originalTransactionId: verification.originalTransactionId
        ? hash(verification.originalTransactionId)
        : null,
      purchaseTokenHash: hash(purchaseToken),
      purchaseTokenEncrypted: encryptBillingToken(purchaseToken),
      currentPeriodEndsAt: verification.currentPeriodEndsAt,
      autoRenewing: verification.autoRenewing,
      rawStorePayload: verification.rawStorePayload,
    });
  } catch (error) {
    if (error.code === 'PURCHASE_ALREADY_CLAIMED') throw new HttpError(409, error.message);
    throw error;
  }

  if (verification.entitled && verification.acknowledgementPending) {
    await acknowledgeGooglePlayPurchase({productId, purchaseToken});
  }
  return {
    valid: verification.entitled,
    entitlement: await store.getBillingEntitlement(userId),
  };
}

async function refreshBillingEntitlement(userId) {
  if (googlePlayBillingMode() === 'not-configured') return;
  const purchases = await store.listBillingPurchases(userId);
  for (const purchase of purchases) {
    if (!purchase.purchaseTokenEncrypted) continue;
    const lastVerified = purchase.lastVerifiedAt
      ? new Date(purchase.lastVerifiedAt).getTime()
      : 0;
    if (lastVerified > Date.now() - BILLING_REFRESH_INTERVAL_MS) continue;
    try {
      const purchaseToken = decryptBillingToken(purchase.purchaseTokenEncrypted);
      const result = await verifyAndStoreGooglePurchase(userId, {
        platform: 'android',
        productId: purchase.productId,
        purchaseToken,
      });
      if (!result.valid) {
        await store.setBillingPurchaseStatus(
          purchase.purchaseTokenHash,
          purchase.purchaseType === 'lifetime' ? 'revoked' : 'expired',
        );
      }
    } catch (error) {
      console.warn('Google Play entitlement refresh failed', error?.message || error);
    }
  }
}

async function processGooglePlayNotification(payload) {
  const message = payload?.message;
  if (!message?.data) throw new HttpError(400, 'A Pub/Sub message is required');
  let notification;
  try {
    notification = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
  } catch {
    throw new HttpError(400, 'The Pub/Sub message is invalid');
  }
  if (notification.packageName !== (process.env.GOOGLE_PLAY_PACKAGE_NAME || 'info.dindin.app')) {
    throw new HttpError(400, 'The Google Play package does not match');
  }
  const subscription = notification.subscriptionNotification;
  const oneTime = notification.oneTimeProductNotification;
  const purchaseToken = String(subscription?.purchaseToken || oneTime?.purchaseToken || '').trim();
  if (!purchaseToken) return {received: true, updated: false};
  const existing = await store.getBillingPurchaseByTokenHash(hash(purchaseToken));
  if (!existing) return {received: true, updated: false};
  const productId = String(subscription?.subscriptionId || oneTime?.sku || existing.productId);
  const result = await verifyAndStoreGooglePurchase(existing.userId, {
    platform: 'android',
    productId,
    purchaseToken,
  });
  return {received: true, updated: true, active: result.entitlement.active};
}

async function sendRemoteReminder(schedule, stage) {
  if (!pushMessaging) return {sent: 0, failed: 0, tokens: 0};
  const registrations = await store.listPushTokens(schedule.userId);
  if (!registrations.length) return {sent: 0, failed: 0, tokens: 0};
  const occurrence = String(new Date(schedule.nextRunAt).getTime());
  const response = await pushMessaging.sendEachForMulticast({
    tokens: registrations.map(item => item.token),
    data: {
      type: 'dindin-reminder',
      scheduleId: schedule.id,
      stage: String(stage),
      occurrence,
    },
    android: {
      priority: 'high',
      ttl: 2 * 60_000,
    },
    apns: {
      headers: {
        'apns-priority': '5',
        'apns-push-type': 'background',
      },
      payload: {
        aps: {
          contentAvailable: true,
        },
      },
    },
  });
  const invalidCodes = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
  ]);
  await Promise.all(response.responses.map((item, index) => {
    if (item.success || !invalidCodes.has(item.error?.code)) return Promise.resolve();
    return store.deletePushToken(schedule.userId, registrations[index].token);
  }));
  const result = {
    sent: response.successCount,
    failed: response.failureCount,
    tokens: registrations.length,
  };
  await store.addSelfEvent(schedule, `push-reminder-${stage}`, result);
  return result;
}

function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '');
  return match?.[1] || '';
}

async function authenticate(request) {
  const user = await store.authenticate(hash(bearerToken(request)));
  if (!user) throw new HttpError(401, 'A valid Din Din session is required');
  return user;
}

function publicCheckIn(checkIn) {
  return {
    id: checkIn.id,
    status: checkIn.status === 'send_failed' ? 'send-failed' : checkIn.status,
    relative: checkIn.relative,
    timezone: checkIn.timezone,
    mode: hasWhatsAppCredentials() ? 'live' : 'simulation',
    nextRunAt: checkIn.nextRunAt,
    latestLocation: checkIn.latestLocation,
    locationShare: checkIn.locationShare,
    events: checkIn.events || [],
  };
}

function publicSelfCheckIn(checkIn) {
  const status = checkIn.status === 'waiting'
    ? (Number(checkIn.stage) === 2 ? 'waiting-second' : 'waiting-first')
    : checkIn.status;
  return {
    id: checkIn.id,
    reminders: selfReminderRules(checkIn),
    times: checkIn.times?.length ? checkIn.times : [checkIn.time].filter(Boolean),
    weekdays: checkIn.weekdays?.length ? checkIn.weekdays : [0, 1, 2, 3, 4, 5, 6],
    timezone: checkIn.timezone,
    nextRunAt: checkIn.nextRunAt,
    status,
    stage: checkIn.stage,
    active: checkIn.active,
    lastResponseAt: checkIn.lastResponseAt,
    events: checkIn.events || [],
  };
}

function selfReminderRules(schedule) {
  if (Array.isArray(schedule.reminders) && schedule.reminders.length) return schedule.reminders;
  const times = schedule.times?.length ? schedule.times : [schedule.time].filter(Boolean);
  const weekdays = schedule.weekdays?.length ? schedule.weekdays.map(Number) : [0, 1, 2, 3, 4, 5, 6];
  return times.map((time, index) => ({id: `legacy-${index + 1}`, time, weekdays}));
}

function clockMinutes(time) {
  const twentyFourHour = /^(\d{2}):(\d{2})$/.exec(time || '');
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
  }
  const legacy = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time || '');
  if (!legacy) return null;
  let hour = Number(legacy[1]) % 12;
  if (legacy[3].toUpperCase() === 'PM') hour += 12;
  return hour * 60 + Number(legacy[2]);
}

function nextSelfOccurrence(schedule, after = Date.now()) {
  const reminders = selfReminderRules(schedule);
  if (!reminders.length) throw new Error('Invalid self check-in clock schedule');
  const afterIst = new Date(after + IST_OFFSET_MINUTES * 60_000);
  const localDayStart = Date.UTC(
    afterIst.getUTCFullYear(), afterIst.getUTCMonth(), afterIst.getUTCDate(), 0, 0, 0, 0,
  );
  for (let dayOffset = 0; dayOffset < 370; dayOffset += 1) {
    const localDay = localDayStart + dayOffset * 24 * 60 * 60_000;
    const weekday = new Date(localDay).getUTCDay();
    const times = reminders
      .filter(reminder => reminder.weekdays.map(Number).includes(weekday))
      .map(reminder => clockMinutes(reminder.time))
      .filter(value => value != null)
      .sort((left, right) => left - right);
    for (const minutes of times) {
      const candidate = localDay + (minutes - IST_OFFSET_MINUTES) * 60_000;
      if (candidate > after) return new Date(candidate).toISOString();
    }
  }
  throw new Error('Could not calculate the next self check-in');
}

function hasMinimumScheduleSpacing(reminders, minimumMinutes = 15) {
  const occurrences = reminders.flatMap(reminder => reminder.weekdays.map(
    day => day * 24 * 60 + clockMinutes(reminder.time),
  ))
    .sort((left, right) => left - right);
  if (new Set(occurrences).size !== occurrences.length) return false;
  if (occurrences.length <= 1) return true;
  return occurrences.every((value, index) => {
    const next = occurrences[(index + 1) % occurrences.length] +
      (index === occurrences.length - 1 ? 7 * 24 * 60 : 0);
    return next - value >= minimumMinutes;
  });
}

async function requireReminderEntitlement(request, user) {
  const developmentPreview =
    process.env.ALLOW_DEVELOPMENT_PREVIEW === 'true' &&
    request.headers['x-dindin-development-preview'] === 'true';
  if (developmentPreview) return {developmentPreview: true};
  const entitlement = await store.getBillingEntitlement(user.id);
  if (!entitlement.active) {
    throw new HttpError(402, 'An active Din Din subscription or lifetime access is required to use reminders');
  }
  return {developmentPreview: false};
}

function nextOccurrence(time, everyDays = 1) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time || '6:00 PM');
  let hour = Number(match?.[1] ?? 6);
  const minute = Number(match?.[2] ?? 0);
  const period = (match?.[3] ?? 'PM').toUpperCase();
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  const nowUtc = Date.now();
  const nowIst = new Date(nowUtc + IST_OFFSET_MINUTES * 60_000);
  let targetIst = Date.UTC(
    nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(), hour, minute, 0, 0,
  );
  if (targetIst <= nowUtc + IST_OFFSET_MINUTES * 60_000) {
    targetIst += everyDays * 24 * 60 * 60_000;
  }
  return new Date(targetIst - IST_OFFSET_MINUTES * 60_000).toISOString();
}

function clearSelfTimers(id) {
  const list = selfTimers.get(id) || [];
  list.forEach(clearTimeout);
  selfTimers.delete(id);
}

function scheduleSelfAtNextRun(schedule) {
  clearSelfTimers(schedule.id);
  if (!schedule.active) return;
  const delay = new Date(schedule.nextRunAt).getTime() - Date.now();
  const first = timerAfter(() => {
    beginSelfCheckIn(schedule.id).catch(error => {
      console.error('Could not start self check-in', error);
    });
  }, delay);
  selfTimers.set(schedule.id, [first]);
}

function restoreSelfWaitingTimers(schedule) {
  clearSelfTimers(schedule.id);
  const startedAt = new Date(schedule.startedAt || Date.now()).getTime();
  const elapsed = Math.max(0, Date.now() - startedAt);
  const list = [];
  if (elapsed < 10 * 60_000) {
    list.push(timerAfter(
      () => promoteSelfReminder(schedule.id).catch(console.error),
      10 * 60_000 - elapsed,
    ));
  } else if (schedule.stage < 2 && elapsed < 11 * 60_000) {
    promoteSelfReminder(schedule.id).catch(console.error);
  }
  if (elapsed < 11 * 60_000) {
    list.push(timerAfter(
      () => escalateSelfCheckIn(schedule.id).catch(console.error),
      11 * 60_000 - elapsed,
    ));
  } else {
    list.push(timerAfter(
      () => escalateSelfCheckIn(schedule.id).catch(console.error),
      25,
    ));
  }
  selfTimers.set(schedule.id, list);
}

async function prepareNextSelfCheckIn(schedule) {
  schedule.nextRunAt = nextSelfOccurrence(schedule);
  await store.updateSelfNextRun(schedule.id, schedule.nextRunAt);
  scheduleSelfAtNextRun(schedule);
}

async function beginSelfCheckIn(id) {
  const schedule = selfCheckIns.get(id) || await store.getSelfScheduleById(id);
  if (!schedule?.active) return;
  const previewAllowed = process.env.ALLOW_DEVELOPMENT_PREVIEW === 'true' &&
    schedule.developmentPreview === true;
  const entitlement = process.env.NODE_ENV === 'production' && !previewAllowed
    ? await store.getBillingEntitlement(schedule.userId)
    : {active: false};
  if (!reminderRuntimeAccess({
    nodeEnv: process.env.NODE_ENV,
    allowDevelopmentPreview: process.env.ALLOW_DEVELOPMENT_PREVIEW === 'true',
    scheduleDevelopmentPreview: schedule.developmentPreview === true,
    entitlementActive: entitlement.active,
  })) {
    const paused = await store.setSelfActive(schedule.id, schedule.userId, false, schedule.nextRunAt);
    if (paused) selfCheckIns.set(schedule.id, paused);
    clearSelfTimers(schedule.id);
    return;
  }
  const startedAt = new Date().toISOString();
  const updated = await store.setSelfState(id, {
    status: 'waiting', stage: 1, startedAt,
  });
  Object.assign(schedule, updated || {}, {status: 'waiting', stage: 1, startedAt});
  selfCheckIns.set(id, schedule);
  await store.addSelfEvent(schedule, 'first-reminder-started');
  restoreSelfWaitingTimers(schedule);
  try {
    await sendRemoteReminder(schedule, 1);
  } catch (error) {
    console.error('Could not send first push reminder', error);
    await store.addSelfEvent(schedule, 'push-reminder-failed', {stage: 1});
  }
}

async function promoteSelfReminder(id) {
  const schedule = selfCheckIns.get(id) || await store.getSelfScheduleById(id);
  if (!schedule?.active || schedule.status !== 'waiting') return false;
  const updated = await store.setSelfState(id, {status: 'waiting', stage: 2});
  Object.assign(schedule, updated || {}, {status: 'waiting', stage: 2});
  selfCheckIns.set(id, schedule);
  await store.addSelfEvent(schedule, 'second-reminder-started');
  try {
    await sendRemoteReminder(schedule, 2);
  } catch (error) {
    console.error('Could not send second push reminder', error);
    await store.addSelfEvent(schedule, 'push-reminder-failed', {stage: 2});
  }
  return true;
}

function circlePhoneSummary(contacts) {
  const summary = contacts.map(item => `${item.name}: ${item.phone}`).join(', ');
  return summary ? summary.slice(0, 900) : 'No other circle contacts';
}

function safetyAlertContact(record) {
  return {id: record.contactId, name: record.contactName, phone: record.contactPhone};
}

function safetyAlertUser(record) {
  return {id: record.userId, name: record.userName, phone: record.userPhone};
}

function clearSafetyAlertTimer(recipientId) {
  const timer = safetyAlertTimers.get(recipientId);
  if (timer) clearTimeout(timer);
  safetyAlertTimers.delete(recipientId);
}

function scheduleSafetyAlertRecipient(record) {
  clearSafetyAlertTimer(record.id);
  if (!record.nextReminderAt || record.acknowledgedAt) return;
  const delay = new Date(record.nextReminderAt).getTime() - Date.now();
  const timer = timerAfter(() => {
    processSafetyAlertReminder(record.id).catch(error => {
      console.error('Could not process safety alert reminder', error);
    });
  }, delay);
  safetyAlertTimers.set(record.id, timer);
}

async function processSafetyAlertReminder(recipientId) {
  clearSafetyAlertTimer(recipientId);
  const record = await store.getSafetyAlertRecipient(recipientId);
  if (
    !record ||
    record.acknowledgedAt ||
    new Date(record.expiresAt).getTime() <= Date.now()
  ) return false;

  const reminderNumber = record.reminderCount + 1;
  if (reminderNumber > 3) return false;
  const retryAt = new Date(Date.now() + SAFETY_ALERT_RETRY_MS).toISOString();
  try {
    const result = await sendSafetyAlertReminderTemplate({
      contact: safetyAlertContact(record),
      user: safetyAlertUser(record),
      reminderNumber,
    });
    const deliveredTemplateName = result.templateName ||
      WHATSAPP_TEMPLATES.safetyAlertReminder;
    const nextReminderAt = reminderNumber < 3 ? retryAt : null;
    await store.recordSafetyAlertDelivery(record.id, {
      templateName: deliveredTemplateName,
      messageId: result.messageId,
      reminderCount: reminderNumber,
      nextReminderAt,
    });
    const schedule = await store.getSelfScheduleById(record.scheduleId);
    if (schedule) {
      await store.addSelfEvent(schedule, 'safety-alert-reminder-sent', {
        alertId: record.alertId,
        contactId: record.contactId,
        reminderNumber,
        messageId: result.messageId,
      });
      // The initial alert is message one. Reminder #1 is therefore the
      // contact's second alert and is the point where calling must start.
      if (reminderNumber === 1) {
        await store.addSelfEvent(schedule, 'automated-call-required', {
          alertId: record.alertId,
          contactId: record.contactId,
          totalAlertMessages: 2,
          callStatus: 'awaiting-provider',
        });
      }
    }
  } catch (error) {
    const failures = await store.recordSafetyAlertFailure(record.id, {
      templateName: WHATSAPP_TEMPLATES.safetyAlertReminder,
      error: error instanceof Error ? error.message : String(error),
      nextReminderAt: retryAt,
    });
    if (failures >= 3) {
      const schedule = await store.getSelfScheduleById(record.scheduleId);
      if (schedule) {
        await store.addSelfEvent(schedule, 'safety-alert-delivery-failed', {
          alertId: record.alertId,
          contactId: record.contactId,
        });
      }
    }
  }
  const updated = await store.getSafetyAlertRecipient(record.id);
  if (updated) scheduleSafetyAlertRecipient(updated);
  return true;
}

async function sendInitialSafetyAlert(record, source, contacts) {
  const contact = safetyAlertContact(record);
  const user = safetyAlertUser(record);
  if (source === 'user-not-okay') {
    return sendUserRequestedHelpTemplate({
      contact,
      user,
      contactSummary: circlePhoneSummary(contacts),
    });
  }
  return sendMissedCheckInTemplate({
    contact,
    user,
  });
}

async function performSelfCheckInEscalation(id, source = 'timer') {
  const schedule = selfCheckIns.get(id) || await store.getSelfScheduleById(id);
  if (!schedule?.active || schedule.status !== 'waiting') return false;
  clearSelfTimers(id);
  const [contacts, user, location] = await Promise.all([
    store.listContacts(schedule.userId),
    store.getUser(schedule.userId),
    store.getSafetyLocation(schedule.userId),
  ]);
  const locationAgeMs = location
    ? Date.now() - new Date(location.capturedAt).getTime()
    : Number.POSITIVE_INFINITY;
  const freshLocation = location && Number.isFinite(locationAgeMs) &&
    locationAgeMs >= 0 && locationAgeMs <= SAFETY_LOCATION_MAX_AGE_MS
    ? location
    : null;
  const primaryContacts = contacts.filter(contact => contact.primary);
  const recipients = source === 'user-not-okay' ? contacts : primaryContacts;
  const alertSource = source === 'user-not-okay'
    ? 'user-not-okay'
    : (source === 'development-test' ? 'development-test' : 'missed');
  const expiresAt = new Date(Date.now() + SAFETY_ALERT_EXPIRY_MS).toISOString();
  // The initial missed-response/help notification is not one of the three
  // follow-up reminders. The first retry therefore starts at reminder #1.
  const initialReminderCount = 0;
  const created = await store.createSafetyAlert({
    schedule,
    user,
    source: alertSource,
    location: freshLocation,
    recipients,
    expiresAt,
    // A reminder only counts after the provider accepts it. Starting persisted
    // recipients at zero also makes a failed first delivery retry reminder #1.
    initialReminderCount: 0,
  });
  // Another request or backend instance already claimed this exact reminder
  // occurrence. It owns all WhatsApp and location delivery for the occurrence.
  if (!created.created) return true;
  const messageResults = await Promise.allSettled(created.recipients.map(async recipient => {
    const nextReminderAt = new Date(Date.now() + SAFETY_ALERT_RETRY_MS).toISOString();
    const templateName = source === 'user-not-okay'
      ? WHATSAPP_TEMPLATES.userRequestedHelp
      : WHATSAPP_TEMPLATES.missedCheckIn;
    try {
      const result = await sendInitialSafetyAlert(recipient, source, contacts);
      await store.recordSafetyAlertDelivery(recipient.id, {
        templateName,
        messageId: result.messageId,
        reminderCount: initialReminderCount,
        nextReminderAt,
      });
      const updated = await store.getSafetyAlertRecipient(recipient.id);
      if (updated) scheduleSafetyAlertRecipient(updated);
      return result;
    } catch (error) {
      await store.recordSafetyAlertFailure(recipient.id, {
        templateName,
        error: error instanceof Error ? error.message : String(error),
        nextReminderAt,
      });
      const updated = await store.getSafetyAlertRecipient(recipient.id);
      if (updated) scheduleSafetyAlertRecipient(updated);
      throw error;
    }
  }));
  const messageFailures = messageResults.filter(result => result.status === 'rejected').length;
  const locationResults = freshLocation
    ? await Promise.allSettled(
        created.recipients.map(recipient => sendSafetyLocationTemplate({
          contact: safetyAlertContact(recipient),
          user: safetyAlertUser(recipient),
          location: freshLocation,
          buttonToken: createSafetyAlertToken(recipient.id),
        })),
      )
    : [];
  const locationFailures = locationResults.filter(result => result.status === 'rejected').length;
  const status = recipients.length > 0 && messageFailures < recipients.length
    ? 'missed'
    : 'send-failed';
  const updated = await store.setSelfState(id, {status, stage: 0});
  Object.assign(schedule, updated || {}, {status, stage: 0});
  selfCheckIns.set(id, schedule);
  const successEvent = source === 'user-not-okay'
    ? 'circle-alerted-by-user'
    : 'primary-contacts-alerted';
  await store.addSelfEvent(schedule, status === 'missed' ? successEvent : 'contact-alert-failed', {
    source,
    recipients: recipients.length,
    messageFailures,
    locationSent: Boolean(freshLocation),
    locationFresh: Boolean(freshLocation),
    locationAgeMs: Number.isFinite(locationAgeMs) ? locationAgeMs : null,
    locationFailures,
    locationCapturedAt: freshLocation?.capturedAt,
    alertId: created.alert.id,
  });
  await prepareNextSelfCheckIn(schedule);
  return true;
}

async function escalateSelfCheckIn(id, source = 'timer') {
  const existing = safetyEscalations.get(id);
  if (existing) return existing;
  const operation = performSelfCheckInEscalation(id, source);
  safetyEscalations.set(id, operation);
  try {
    return await operation;
  } finally {
    if (safetyEscalations.get(id) === operation) safetyEscalations.delete(id);
  }
}

function assertCurrentSelfOccurrence(schedule, occurrence) {
  if (occurrence == null || occurrence === '') return;
  const expected = new Date(schedule.nextRunAt).getTime();
  if (!Number.isFinite(Number(occurrence)) || Number(occurrence) !== expected) {
    throw new HttpError(409, 'This reminder occurrence is no longer active');
  }
}

async function acknowledgeSelfCheckIn(id, ownerUserId, source = 'app', occurrence) {
  const schedule = selfCheckIns.get(id) || await store.getSelfScheduleById(id, ownerUserId);
  if (!schedule || schedule.userId !== ownerUserId) return null;
  assertCurrentSelfOccurrence(schedule, occurrence);
  if (schedule.status === 'safe') return schedule;
  if (schedule.status !== 'waiting') {
    throw new HttpError(409, 'This check-in is not waiting for a response');
  }
  clearSelfTimers(id);
  const lastResponseAt = new Date().toISOString();
  const updated = await store.setSelfState(id, {
    status: 'safe', stage: 0, lastResponseAt,
  });
  Object.assign(schedule, updated || {}, {status: 'safe', stage: 0, lastResponseAt});
  selfCheckIns.set(id, schedule);
  await store.addSelfEvent(schedule, 'confirmed-safe', {source});
  await prepareNextSelfCheckIn(schedule);
  return schedule;
}

function clearCheckInTimers(id) {
  const list = timers.get(id) || [];
  list.forEach(clearTimeout);
  timers.delete(id);
}

function timerAfter(callback, delay) {
  return setTimeout(callback, Math.max(25, Math.min(delay, 2_147_000_000)));
}

function scheduleAtNextRun(checkIn) {
  clearCheckInTimers(checkIn.id);
  const delay = new Date(checkIn.nextRunAt).getTime() - Date.now();
  const first = timerAfter(() => {
    beginCheckIn(checkIn.id).catch(error => handleSendFailure(checkIn, error));
  }, delay);
  timers.set(checkIn.id, [first]);
}

function restoreWaitingTimers(checkIn) {
  clearCheckInTimers(checkIn.id);
  const startedAt = new Date(checkIn.startedAt || Date.now()).getTime();
  const elapsed = Date.now() - startedAt;
  const list = [];
  if (elapsed < 10 * 60_000) list.push(timerAfter(() => sendReminder(checkIn.id, 1), 10 * 60_000 - elapsed));
  if (elapsed < 20 * 60_000) list.push(timerAfter(() => sendReminder(checkIn.id, 2), 20 * 60_000 - elapsed));
  list.push(timerAfter(() => markMissed(checkIn.id), Math.max(25, 30 * 60_000 - elapsed)));
  timers.set(checkIn.id, list);
}

async function prepareNext(checkIn) {
  checkIn.nextRunAt = nextOccurrence(checkIn.relative.time, intervalDays(checkIn.relative.interval));
  await store.updateNextRun(checkIn.id, checkIn.nextRunAt);
  scheduleAtNextRun(checkIn);
}

async function handleSendFailure(checkIn, error) {
  checkIn.status = 'send_failed';
  await store.setRunStatus(checkIn, 'send_failed');
  await store.addEvent(checkIn, 'send-failed', {detail: String(error)});
}

async function sendWhatsAppTemplate(checkIn, reminderNumber = 0) {
  if (!hasWhatsAppCredentials()) {
    console.log(`[simulation] WhatsApp ${reminderNumber ? `reminder ${reminderNumber}` : 'check-in'} for ${checkIn.relative.name}`);
    return {mode: 'simulation', messageId: `sim-${randomUUID()}`};
  }
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v24.0';
  const endpoint = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp', recipient_type: 'individual',
    to: normalizePhone(checkIn.relative.phone).slice(1), type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME || 'dindin_check_in',
      language: {code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en'},
      components: [
        {type: 'body', parameters: [
          {type: 'text', text: checkIn.relative.name},
          {type: 'text', text: reminderNumber ? `Reminder ${reminderNumber}` : 'Check-in'},
        ]},
        {type: 'button', sub_type: 'quick_reply', index: '0', parameters: [
          {type: 'payload', payload: `dindin_ok:${checkIn.id}`},
        ]},
      ],
    },
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`WhatsApp Cloud API failed (${response.status})`);
  return {mode: 'live', messageId: result.messages?.[0]?.id ?? null};
}

async function beginCheckIn(id) {
  const checkIn = checkIns.get(id) || await store.getSchedule(id);
  if (!checkIn) return;
  checkIns.set(id, checkIn);
  checkIn.runId = await store.beginRun(checkIn);
  checkIn.status = 'waiting';
  checkIn.startedAt = new Date().toISOString();
  try {
    const sent = await sendWhatsAppTemplate(checkIn, 0);
    await store.addEvent(checkIn, 'check-in-sent', {}, sent.messageId);
  } catch (error) {
    await handleSendFailure(checkIn, error);
    return;
  }
  restoreWaitingTimers(checkIn);
}

async function sendReminder(id, number) {
  const checkIn = checkIns.get(id);
  if (!checkIn || checkIn.status !== 'waiting') return;
  try {
    const sent = await sendWhatsAppTemplate(checkIn, number);
    await store.addEvent(checkIn, `reminder-${number}-sent`, {}, sent.messageId);
  } catch (error) {
    await store.addEvent(checkIn, `reminder-${number}-failed`, {detail: String(error)});
  }
}

async function markMissed(id, source = 'timer') {
  const checkIn = checkIns.get(id);
  if (!checkIn || checkIn.status !== 'waiting') return false;
  checkIn.status = 'missed';
  await store.setRunStatus(checkIn, 'missed');
  await store.addEvent(checkIn, 'missed', {source});
  await prepareNext(checkIn);
  return true;
}

function extractButtonPayload(payload) {
  const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  return message?.button?.payload || message?.interactive?.button_reply?.id || null;
}

function webhookId(payload) {
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  return value?.messages?.[0]?.id || value?.statuses?.[0]?.id || hash(JSON.stringify(payload));
}

function techiesWebhookAuthorized(request, url) {
  const expected = process.env.TECHIES_WHATSAPP_WEBHOOK_SECRET;
  if (!expected) throw new HttpError(503, 'WhatsApp webhook is not configured');
  const supplied = request.headers['x-dindin-webhook-secret'] ||
    url.searchParams.get('token');
  return secureValueMatches(supplied, expected);
}

function samePhoneNumber(left, right) {
  return normalizePhone(left).replace(/\D/g, '') ===
    normalizePhone(right).replace(/\D/g, '');
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return json(response, 204, {});
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      await store.health();
      return json(response, 200, {
        ok: true, service: 'dindin-api', database: store.mode,
        whatsapp: hasWhatsAppCredentials() ? 'live' : 'simulation',
        otp: hasOtpProvider() ? 'configured' : 'not-configured',
        push: pushMode(),
        billing: googlePlayBillingMode(),
        billingNotifications: process.env.GOOGLE_PLAY_RTDN_TOKEN ? 'configured' : 'not-configured',
        checkInModel: 'self',
      });
    }

    if (request.method === 'POST' && url.pathname === '/v1/auth/request-otp') {
      const input = await body(request);
      const phone = normalizePhone(input.phone);
      if (!/^\+\d{10,15}$/.test(phone)) throw new HttpError(400, 'A valid phone number is required');
      const reviewerCode = playReviewerOtp(phone);
      if (!reviewerCode && !hasOtpProvider()) {
        throw new HttpError(503, 'Mobile verification is temporarily unavailable');
      }

      const state = await store.getOtpRequestState(phone);
      const lastRequestedAt = state.lastRequestedAt ? new Date(state.lastRequestedAt).getTime() : 0;
      if (lastRequestedAt && Date.now() - lastRequestedAt < OTP_REQUEST_COOLDOWN_MS) {
        throw new HttpError(429, 'Please wait one minute before requesting another code');
      }
      if (state.requestCountLastHour >= OTP_MAX_REQUESTS_PER_HOUR) {
        throw new HttpError(429, 'Too many verification codes requested. Please try again later');
      }

      const code = reviewerCode || (
        process.env.NODE_ENV === 'test' && process.env.OTP_TEST_CODE
          ? process.env.OTP_TEST_CODE
          : String(randomInt(100000, 1000000))
      );
      const codeHash = otpHash(phone, code);
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000).toISOString();
      await store.createOtpChallenge({phone, codeHash, expiresAt});
      try {
        if (!reviewerCode) await sendOtpMessage(phone, code);
      } catch (error) {
        await store.invalidateOtpChallenge(phone, codeHash);
        throw error;
      }
      return json(response, 202, {sent: true, expiresInSeconds: OTP_EXPIRY_MINUTES * 60});
    }

    if (request.method === 'POST' && url.pathname === '/v1/auth/verify-otp') {
      const input = await body(request);
      const phone = normalizePhone(input.phone);
      const name = String(input.name || '').trim();
      if (!/^\+\d{10,15}$/.test(phone) || name.length < 2) throw new HttpError(400, 'A valid name and phone number are required');
      const code = String(input.otp || '');
      if (!/^\d{6}$/.test(code) || (!playReviewerOtp(phone) && !hasOtpProvider())) {
        throw new HttpError(400, 'The verification code is invalid or expired');
      }
      const verified = await store.consumeOtpChallenge({
        phone,
        codeHash: otpHash(phone, code),
        maxAttempts: OTP_MAX_ATTEMPTS,
      });
      if (!verified) throw new HttpError(400, 'The verification code is invalid or expired');
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60_000).toISOString();
      const user = await store.createUserSession({phone, name, tokenHash: hash(token), expiresAt});
      return json(response, 200, {user, token, expiresAt});
    }

    const safetyAlertMatch =
      /^\/(?:alert|alerts|safety-alert|safety-alerts|safety-location|location|locations)(?:\/share)?\/([A-Za-z0-9._-]+)(\/acknowledge)?$/
        .exec(url.pathname);
    if (safetyAlertMatch && ['GET', 'HEAD', 'POST'].includes(request.method)) {
      const recipientId = verifySafetyAlertToken(safetyAlertMatch[1]);
      const record = recipientId ? await store.getSafetyAlertRecipient(recipientId) : null;
      if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
        return html(response, 410, renderExpiredSafetyAlertPage());
      }
      if (request.method === 'POST') {
        if (!safetyAlertMatch[2]) {
          return html(response, 405, renderSafetyAlertPage(record, {
            token: safetyAlertMatch[1],
          }));
        }
        const acknowledged = await store.acknowledgeSafetyAlertRecipient(recipientId);
        if (!acknowledged) return html(response, 410, renderExpiredSafetyAlertPage());
        clearSafetyAlertTimer(recipientId);
        const schedule = await store.getSelfScheduleById(acknowledged.scheduleId);
        if (schedule) {
          await store.addSelfEvent(schedule, 'safety-alert-acknowledged', {
            alertId: acknowledged.alertId,
            contactId: acknowledged.contactId,
          });
        }
        return html(response, 200, renderSafetyAlertPage(acknowledged, {
          token: safetyAlertMatch[1],
          acknowledged: true,
        }));
      }
      return html(response, 200, renderSafetyAlertPage(record, {
        token: safetyAlertMatch[1],
      }));
    }

    if (url.pathname === '/webhooks/whatsapp' && request.method === 'GET') {
      const valid = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === process.env.WHATSAPP_VERIFY_TOKEN;
      if (!valid) throw new HttpError(403, 'Webhook verification failed');
      response.writeHead(200, {'Content-Type': 'text/plain'});
      return response.end(url.searchParams.get('hub.challenge') || '');
    }
    if (url.pathname === '/webhooks/whatsapp' && request.method === 'POST') {
      const payload = await body(request);
      const fresh = await store.recordWebhook('whatsapp', webhookId(payload), hash(JSON.stringify(payload)));
      if (fresh) {
        const buttonPayload = extractButtonPayload(payload);
        if (buttonPayload?.startsWith('dindin_ok:')) {
          console.log('[retired] Ignored legacy relative check-in reply');
        }
      }
      return json(response, 200, {received: true});
    }

    if (url.pathname === '/webhooks/techies/whatsapp' && request.method === 'POST') {
      if (!techiesWebhookAuthorized(request, url)) {
        throw new HttpError(403, 'Webhook authentication failed');
      }
      const payload = await body(request);
      const reply = parseTechiesQuickReply(payload);
      if (!reply) return json(response, 200, {received: true, ignored: true});

      const recipient = await store.getSafetyAlertRecipientByProviderMessageId(
        reply.targetedMessageId,
      );
      if (!recipient || !samePhoneNumber(recipient.contactPhone, reply.senderPhone)) {
        return json(response, 200, {received: true, acknowledged: false});
      }

      // Acknowledgement is idempotent and happens before webhook deduplication:
      // if recording the webhook fails, a provider retry can still finish safely.
      const acknowledged = await store.acknowledgeSafetyAlertRecipient(recipient.id);
      if (!acknowledged) {
        return json(response, 200, {received: true, acknowledged: false});
      }
      clearSafetyAlertTimer(recipient.id);
      const fresh = await store.recordWebhook(
        'techies-whatsapp',
        reply.inboundMessageId,
        hash(JSON.stringify(payload)),
      );
      if (fresh) {
        const schedule = await store.getSelfScheduleById(acknowledged.scheduleId);
        if (schedule) {
          await store.addSelfEvent(schedule, 'safety-alert-acknowledged', {
            alertId: acknowledged.alertId,
            contactId: acknowledged.contactId,
            source: 'techies-quick-reply',
            inboundMessageId: reply.inboundMessageId,
            targetedMessageId: reply.targetedMessageId,
          });
        }
      }
      return json(response, 200, {
        received: true,
        acknowledged: true,
        duplicate: !fresh,
      });
    }

    if (url.pathname === '/webhooks/google-play' && request.method === 'POST') {
      if (!secureValueMatches(url.searchParams.get('token'), process.env.GOOGLE_PLAY_RTDN_TOKEN)) {
        throw new HttpError(403, 'Webhook authentication failed');
      }
      const payload = await body(request);
      const externalId = String(payload?.message?.messageId || payload?.message?.message_id || hash(JSON.stringify(payload)));
      const result = await processGooglePlayNotification(payload);
      const fresh = await store.recordWebhook('google-play', externalId, hash(JSON.stringify(payload)));
      return json(response, 200, {...result, duplicate: !fresh});
    }

    const user = await authenticate(request);
    if (/^\/v1\/check-ins(?:\/|$)/.test(url.pathname)) {
      return json(response, 410, {error: 'This relative check-in API has been retired'});
    }
    if (request.method === 'POST' && url.pathname === '/v1/auth/logout') {
      await store.deletePushTokensForUser(user.id);
      await store.revokeSession(hash(bearerToken(request)));
      return json(response, 200, {loggedOut: true});
    }
    if (request.method === 'GET' && url.pathname === '/v1/me') {
      return json(response, 200, {user: await store.getUser(user.id)});
    }
    if (request.method === 'PATCH' && url.pathname === '/v1/me') {
      const input = await body(request);
      const name = String(input.name || '').trim();
      if (name.length < 2) throw new HttpError(400, 'Name must have at least 2 characters');
      return json(response, 200, {user: await store.updateUser(user.id, name)});
    }
    if (request.method === 'DELETE' && url.pathname === '/v1/me') {
      const ownedSchedules = await store.listSchedules(user.id);
      ownedSchedules.forEach(item => {
        clearCheckInTimers(item.id);
        checkIns.delete(item.id);
      });
      const selfSchedule = await store.getSelfSchedule(user.id);
      if (selfSchedule) {
        clearSelfTimers(selfSchedule.id);
        selfCheckIns.delete(selfSchedule.id);
      }
      await store.deleteUser(user.id);
      return json(response, 200, {deleted: true});
    }
    if (request.method === 'GET' && url.pathname === '/v1/me/preferences') {
      return json(response, 200, {preferences: await store.getPreferences(user.id)});
    }
    if (request.method === 'PUT' && url.pathname === '/v1/me/preferences') {
      return json(response, 200, {preferences: await store.savePreferences(user.id, await body(request))});
    }
    if (request.method === 'PUT' && url.pathname === '/v1/me/safety-location') {
      const location = parseSafetyLocation(await body(request));
      return json(response, 200, {location: await store.saveSafetyLocation(user.id, location)});
    }

    if (request.method === 'POST' && url.pathname === '/v1/push-tokens') {
      const input = await body(request);
      const token = String(input.token || '').trim();
      const platform = String(input.platform || '').trim();
      if (token.length < 20 || token.length > 4096 || !['android', 'ios'].includes(platform)) {
        throw new HttpError(400, 'A valid push token and platform are required');
      }
      await store.upsertPushToken(user.id, token, platform);
      return json(response, 200, {registered: true});
    }
    if (request.method === 'DELETE' && url.pathname === '/v1/push-tokens') {
      const input = await body(request);
      const token = String(input.token || '').trim();
      if (!token) throw new HttpError(400, 'A push token is required');
      await store.deletePushToken(user.id, token);
      return json(response, 200, {deleted: true});
    }

    if (request.method === 'GET' && url.pathname === '/v1/contacts') {
      return json(response, 200, {items: await store.listContacts(user.id)});
    }
    if (request.method === 'POST' && url.pathname === '/v1/contacts') {
      const input = await body(request);
      const contact = {
        name: String(input.name || '').trim(),
        relationship: String(input.relationship || 'Family').trim(),
        phone: normalizePhone(input.phone),
        primary: input.primary !== false,
      };
      if (contact.name.length < 2 || !/^\+\d{10,15}$/.test(contact.phone)) {
        throw new HttpError(400, 'A valid contact name and WhatsApp number are required');
      }
      const createdContact = await store.createContact(user.id, contact);
      let callPermissionRequest = {sent: false};
      try {
        const delivery = await sendCallPermissionTemplate({contact: createdContact, user});
        callPermissionRequest = {sent: true, mode: delivery.mode};
      } catch (error) {
        console.error(
          `Could not send WhatsApp calling permission request for contact ${createdContact.id}:`,
          error instanceof Error ? error.message : 'Unknown provider error',
        );
      }
      return json(response, 201, {contact: createdContact, callPermissionRequest});
    }

    const contactMatch = /^\/v1\/contacts\/([^/]+)$/.exec(url.pathname);
    if (contactMatch && request.method === 'PUT') {
      const existing = (await store.listContacts(user.id)).find(item => item.id === contactMatch[1]);
      if (!existing) throw new HttpError(404, 'Contact not found');
      const input = await body(request);
      const changes = {};
      if (input.name !== undefined) {
        changes.name = String(input.name).trim();
        if (changes.name.length < 2) throw new HttpError(400, 'Contact name must have at least 2 characters');
      }
      if (input.relationship !== undefined) changes.relationship = String(input.relationship).trim();
      if (input.phone !== undefined) {
        changes.phone = normalizePhone(input.phone);
        if (!/^\+\d{10,15}$/.test(changes.phone)) throw new HttpError(400, 'A valid WhatsApp number is required');
      }
      if (input.primary !== undefined) changes.primary = input.primary === true;
      if (existing.primary && changes.primary === false) {
        const contacts = await store.listContacts(user.id);
        const schedule = await store.getSelfSchedule(user.id);
        if (schedule?.active && contacts.filter(item => item.primary).length === 1) {
          throw new HttpError(409, 'Keep at least one primary contact while your reminder is active');
        }
      }
      const contact = await store.updateContact(contactMatch[1], user.id, changes);
      return json(response, 200, {contact});
    }
    if (contactMatch && request.method === 'DELETE') {
      const contacts = await store.listContacts(user.id);
      const existing = contacts.find(item => item.id === contactMatch[1]);
      if (!existing) throw new HttpError(404, 'Contact not found');
      const schedule = await store.getSelfSchedule(user.id);
      if (existing.primary && schedule?.active && contacts.filter(item => item.primary).length === 1) {
        throw new HttpError(409, 'Keep at least one primary contact while your reminder is active');
      }
      await store.deleteContact(contactMatch[1], user.id);
      return json(response, 200, {deleted: true});
    }

    if (request.method === 'GET' && url.pathname === '/v1/self-check-in') {
      const schedule = await store.getSelfSchedule(user.id);
      if (schedule) selfCheckIns.set(schedule.id, {...selfCheckIns.get(schedule.id), ...schedule});
      return json(response, 200, {schedule: schedule ? publicSelfCheckIn({...selfCheckIns.get(schedule.id), ...schedule}) : null});
    }
    if (request.method === 'DELETE' && url.pathname === '/v1/self-check-in') {
      const schedule = await store.getSelfSchedule(user.id);
      if (!schedule) throw new HttpError(404, 'Self check-in reminder not found');
      clearSelfTimers(schedule.id);
      await store.deleteSelfSchedule(user.id);
      selfCheckIns.delete(schedule.id);
      return json(response, 200, {deleted: true});
    }
    if (request.method === 'PUT' && url.pathname === '/v1/self-check-in') {
      const input = await body(request);
      const reminders = Array.isArray(input.reminders)
        ? input.reminders.map((item, index) => ({
            id: String(item?.id || `reminder-${index + 1}`).trim(),
            time: String(item?.time || '').trim(),
            weekdays: Array.isArray(item?.weekdays)
              ? [...new Set(item.weekdays.map(Number))].sort((left, right) => left - right)
              : [],
          }))
        : [];
      const validPattern =
        reminders.length >= 1 && reminders.length <= 12 &&
        new Set(reminders.map(item => item.id)).size === reminders.length &&
        reminders.every(item =>
          /^[a-zA-Z0-9_-]{1,64}$/.test(item.id) &&
          /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time) &&
          item.weekdays.length >= 1 && item.weekdays.length <= 7 &&
          item.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
        ) &&
        hasMinimumScheduleSpacing(reminders);
      if (!validPattern) {
        throw new HttpError(400, 'Choose 1 to 12 valid reminders with a 24-hour time, active days, and at least 15 minutes between occurrences');
      }
      const reminderAccess = await requireReminderEntitlement(request, user);
      const contacts = await store.listContacts(user.id);
      if (!contacts.some(contact => contact.primary)) {
        throw new HttpError(409, 'Add at least one primary contact before activating a reminder');
      }
      const preferences = await store.getPreferences(user.id);
      if (!preferences?.safetyLocation) {
        throw new HttpError(409, 'Enable Always safety location before activating a reminder');
      }
      const previous = await store.getSelfSchedule(user.id);
      if (previous) clearSelfTimers(previous.id);
      const scheduleValues = {
        reminders,
      };
      const nextRunAt = nextSelfOccurrence(scheduleValues);
      const schedule = await store.upsertSelfSchedule({
        userId: user.id,
        ...scheduleValues,
        timezone: String(input.timezone || 'Asia/Kolkata'),
        nextRunAt,
        developmentPreview: reminderAccess.developmentPreview,
      });
      selfCheckIns.set(schedule.id, schedule);
      await store.addSelfEvent(schedule, previous ? 'schedule-updated' : 'schedule-created');
      scheduleSelfAtNextRun(schedule);
      return json(response, 200, {schedule: publicSelfCheckIn(schedule)});
    }
    if (request.method === 'PUT' && url.pathname === '/v1/self-check-in/active') {
      const input = await body(request);
      if (typeof input.active !== 'boolean') {
        throw new HttpError(400, 'active must be true or false');
      }
      const schedule = await store.getSelfSchedule(user.id);
      if (!schedule) throw new HttpError(404, 'Self check-in reminder not found');
      let reminderAccess = null;
      if (input.active) {
        reminderAccess = await requireReminderEntitlement(request, user);
        const [contacts, preferences] = await Promise.all([
          store.listContacts(user.id),
          store.getPreferences(user.id),
        ]);
        if (!contacts.some(contact => contact.primary)) {
          throw new HttpError(409, 'Add at least one primary contact before turning reminders on');
        }
        if (!preferences?.safetyLocation) {
          throw new HttpError(409, 'Enable Always safety location before turning reminders on');
        }
      }
      clearSelfTimers(schedule.id);
      const nextRunAt = input.active ? nextSelfOccurrence(schedule) : schedule.nextRunAt;
      const updated = await store.setSelfActive(
        schedule.id,
        user.id,
        input.active,
        nextRunAt,
        reminderAccess?.developmentPreview ?? null,
      );
      selfCheckIns.set(schedule.id, updated);
      await store.addSelfEvent(updated, input.active ? 'schedule-resumed' : 'schedule-paused');
      if (input.active) scheduleSelfAtNextRun(updated);
      return json(response, 200, {schedule: publicSelfCheckIn(updated)});
    }
    if (request.method === 'POST' && url.pathname === '/v1/self-check-in/acknowledge') {
      const input = await body(request);
      const scheduleId = String(input.scheduleId || '');
      const schedule = await acknowledgeSelfCheckIn(scheduleId, user.id, 'app', input.occurrence);
      if (!schedule) throw new HttpError(404, 'Self check-in reminder not found');
      return json(response, 200, {schedule: publicSelfCheckIn(schedule)});
    }
    if (request.method === 'POST' && url.pathname === '/v1/self-check-in/escalate') {
      const input = await body(request);
      const scheduleId = String(input.scheduleId || '');
      let schedule = await store.getSelfScheduleById(scheduleId, user.id);
      if (!schedule) throw new HttpError(404, 'Self check-in reminder not found');
      assertCurrentSelfOccurrence(schedule, input.occurrence);
      if (input.location) {
        await store.saveSafetyLocation(user.id, parseSafetyLocation(input.location));
      }
      const closeToReminder = Math.abs(new Date(schedule.nextRunAt).getTime() - Date.now()) < 2 * 60_000;
      if (schedule.status !== 'waiting' && closeToReminder) {
        selfCheckIns.set(schedule.id, schedule);
        await beginSelfCheckIn(schedule.id);
        schedule = selfCheckIns.get(schedule.id);
      }
      if (schedule.status !== 'waiting') {
        throw new HttpError(409, 'This check-in is not waiting for a response');
      }
      await escalateSelfCheckIn(schedule.id, 'user-not-okay');
      return json(response, 200, {schedule: publicSelfCheckIn(selfCheckIns.get(schedule.id))});
    }

    const selfSimulationMatch = /^\/v1\/self-check-in\/simulate-(first|second|missed)$/.exec(url.pathname);
    if (request.method === 'POST' && selfSimulationMatch && process.env.NODE_ENV !== 'production') {
      const schedule = await store.getSelfSchedule(user.id);
      if (!schedule) throw new HttpError(404, 'Self check-in reminder not found');
      selfCheckIns.set(schedule.id, schedule);
      if (selfSimulationMatch[1] === 'first') await beginSelfCheckIn(schedule.id);
      if (selfSimulationMatch[1] === 'second') {
        if (schedule.status !== 'waiting') await beginSelfCheckIn(schedule.id);
        await promoteSelfReminder(schedule.id);
      }
      if (selfSimulationMatch[1] === 'missed') {
        if (schedule.status !== 'waiting') await beginSelfCheckIn(schedule.id);
        await promoteSelfReminder(schedule.id);
        await escalateSelfCheckIn(schedule.id, 'development-test');
      }
      return json(response, 200, {schedule: publicSelfCheckIn(selfCheckIns.get(schedule.id))});
    }

    if (request.method === 'POST' && url.pathname === '/v1/check-ins') {
      const input = await body(request);
      const source = input.relative || {};
      const relative = {...source, phone: normalizePhone(source.phone), reminders: Math.max(0, Math.min(2, Number(source.reminders ?? 2)))};
      if (!relative.name || !/^\+\d{10,15}$/.test(relative.phone) || !relative.time) {
        throw new HttpError(400, 'relative.name, relative.phone and relative.time are required');
      }
      const nextRunAt = nextOccurrence(relative.time, 1);
      const checkIn = await store.createSchedule({ownerUserId: user.id, relative, timezone: input.timezone || 'Asia/Kolkata', nextRunAt});
      checkIns.set(checkIn.id, checkIn);
      scheduleAtNextRun(checkIn);
      return json(response, 201, {
        id: checkIn.id,
        mode: hasWhatsAppCredentials() ? 'live' : 'simulation',
        message: hasWhatsAppCredentials() ? 'WhatsApp schedule created' : 'Schedule created in simulation mode',
        nextRunAt,
      });
    }
    if (request.method === 'GET' && url.pathname === '/v1/check-ins') {
      const items = await store.listSchedules(user.id);
      items.forEach(item => checkIns.set(item.id, {...checkIns.get(item.id), ...item}));
      return json(response, 200, {items: items.map(publicCheckIn)});
    }

    const checkInMatch = /^\/v1\/check-ins\/([^/]+)$/.exec(url.pathname);
    if (checkInMatch && request.method === 'GET') {
      const item = await store.getSchedule(checkInMatch[1], user.id);
      return item ? json(response, 200, publicCheckIn({...checkIns.get(item.id), ...item})) : json(response, 404, {error: 'Check-in not found'});
    }
    if (checkInMatch && request.method === 'DELETE') {
      clearCheckInTimers(checkInMatch[1]);
      const deleted = await store.deleteSchedule(checkInMatch[1], user.id);
      checkIns.delete(checkInMatch[1]);
      return deleted ? json(response, 200, {deleted: true}) : json(response, 404, {error: 'Check-in not found'});
    }

    const missedMatch = /^\/v1\/check-ins\/([^/]+)\/simulate-missed$/.exec(url.pathname);
    if (request.method === 'POST' && missedMatch && process.env.NODE_ENV !== 'production') {
      const item = checkIns.get(missedMatch[1]) || await store.getSchedule(missedMatch[1], user.id);
      if (!item || item.ownerUserId !== user.id) throw new HttpError(404, 'Check-in not found');
      checkIns.set(item.id, item);
      item.status = 'waiting';
      await store.setRunStatus(item, 'waiting');
      await markMissed(item.id, 'development-test');
      return json(response, 200, publicCheckIn(item));
    }
    const reminderMatch = /^\/v1\/check-ins\/([^/]+)\/simulate-reminder-2$/.exec(url.pathname);
    if (request.method === 'POST' && reminderMatch && process.env.NODE_ENV !== 'production') {
      const item = checkIns.get(reminderMatch[1]) || await store.getSchedule(reminderMatch[1], user.id);
      if (!item || item.ownerUserId !== user.id) throw new HttpError(404, 'Check-in not found');
      checkIns.set(item.id, item);
      item.status = 'waiting';
      await store.setRunStatus(item, 'waiting');
      await sendReminder(item.id, 2);
      return json(response, 200, publicCheckIn(item));
    }

    if (request.method === 'GET' && url.pathname === '/v1/family') {
      await refreshBillingEntitlement(user.id);
      return json(response, 200, {family: await store.getFamilyPlan(user.id)});
    }
    if (request.method === 'POST' && url.pathname === '/v1/family/members') {
      await refreshBillingEntitlement(user.id);
      const family = await store.getFamilyPlan(user.id);
      if (family.role !== 'owner' || !family.active) {
        throw new HttpError(402, 'An active Din Din family plan is required');
      }
      const input = await body(request);
      const phone = normalizePhone(input.phone);
      if (!/^\+\d{10,15}$/.test(phone)) {
        throw new HttpError(400, 'Enter a valid mobile number with country code');
      }
      try {
        await store.addFamilyMember(user.id, phone, family.capacity);
      } catch (error) {
        if (['FAMILY_SELF', 'FAMILY_PHONE_ASSIGNED', 'FAMILY_FULL'].includes(error.code)) {
          throw new HttpError(409, error.message);
        }
        throw error;
      }
      return json(response, 201, {family: await store.getFamilyPlan(user.id)});
    }

    if (request.method === 'GET' && url.pathname === '/v1/billing/entitlement') {
      await refreshBillingEntitlement(user.id);
      return json(response, 200, {entitlement: await store.getBillingEntitlement(user.id)});
    }
    if (request.method === 'POST' && url.pathname === '/v1/billing/verify') {
      return json(response, 200, await verifyAndStoreGooglePurchase(user.id, await body(request)));
    }
    return json(response, 404, {error: 'Not found'});
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error(error);
    return json(response, status, {error: error instanceof Error ? error.message : 'Unexpected server error'});
  }
});

async function start() {
  await store.connect();
  const pendingSafetyAlerts = await store.listPendingSafetyAlertRecipients();
  pendingSafetyAlerts.forEach(scheduleSafetyAlertRecipient);
  const restoredSelfCheckIns = await store.loadActiveSelfSchedules();
  restoredSelfCheckIns.forEach(schedule => {
    selfCheckIns.set(schedule.id, schedule);
    if (schedule.status === 'waiting') restoreSelfWaitingTimers(schedule);
    else if (new Date(schedule.nextRunAt).getTime() <= Date.now()) {
      beginSelfCheckIn(schedule.id).catch(console.error);
    } else {
      scheduleSelfAtNextRun(schedule);
    }
  });
  server.listen(PORT, HOST, () => {
    console.log(`Din Din API listening on http://${HOST}:${PORT}`);
    console.log(`Database mode: ${store.mode}`);
    console.log(`WhatsApp mode: ${hasWhatsAppCredentials() ? 'live' : 'simulation'}`);
    console.log(`Push mode: ${pushMode()}`);
  });
}

async function shutdown() {
  for (const id of timers.keys()) clearCheckInTimers(id);
  for (const id of selfTimers.keys()) clearSelfTimers(id);
  for (const id of safetyAlertTimers.keys()) clearSafetyAlertTimer(id);
  server.close();
  await store.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

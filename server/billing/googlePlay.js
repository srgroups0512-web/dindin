import {GoogleAuth} from 'google-auth-library';
import {
  FAMILY_BASE_PLAN_IDS,
  FAMILY_LIFETIME_PRODUCT_IDS,
  FAMILY_SUBSCRIPTION_PRODUCT_ID,
  INDIVIDUAL_BASE_PLAN_IDS,
  INDIVIDUAL_LIFETIME_PRODUCT_ID,
  INDIVIDUAL_SUBSCRIPTION_PRODUCT_ID,
  isSubscriptionProduct,
} from './products.js';

const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const DEFAULT_PACKAGE_NAME = 'info.dindin.app';
const ALLOWED_BASE_PLANS = new Map([
  [INDIVIDUAL_SUBSCRIPTION_PRODUCT_ID, new Set(INDIVIDUAL_BASE_PLAN_IDS)],
  [FAMILY_SUBSCRIPTION_PRODUCT_ID, new Set(FAMILY_BASE_PLAN_IDS)],
]);

let authClientPromise;

function isTestProvider() {
  return process.env.NODE_ENV === 'test' && process.env.GOOGLE_PLAY_BILLING_MOCK === 'true';
}

export function googlePlayBillingMode() {
  if (isTestProvider()) return 'test';
  return process.env.GOOGLE_PLAY_CREDENTIALS ? 'configured' : 'not-configured';
}

function packageName() {
  return process.env.GOOGLE_PLAY_PACKAGE_NAME || DEFAULT_PACKAGE_NAME;
}

async function authClient() {
  if (!process.env.GOOGLE_PLAY_CREDENTIALS) {
    throw new Error('Google Play billing credentials are not configured');
  }
  authClientPromise ||= new GoogleAuth({
    keyFile: process.env.GOOGLE_PLAY_CREDENTIALS,
    scopes: [ANDROID_PUBLISHER_SCOPE],
  }).getClient();
  return authClientPromise;
}

async function googleRequest(options) {
  try {
    const client = await authClient();
    const response = await client.request(options);
    return response.data;
  } catch (error) {
    const status = Number(error?.response?.status || 0);
    if ([400, 404, 410].includes(status)) return null;
    const message = error?.response?.data?.error?.message || error?.message || 'Google Play request failed';
    const wrapped = new Error(message);
    wrapped.status = status;
    throw wrapped;
  }
}

function latestSubscriptionLine(lines = []) {
  return [...lines].sort((left, right) => {
    const leftExpiry = new Date(left.expiryTime || 0).getTime();
    const rightExpiry = new Date(right.expiryTime || 0).getTime();
    return rightExpiry - leftExpiry;
  })[0] || null;
}

function normalizeSubscription(data) {
  const line = latestSubscriptionLine(data.lineItems);
  const productId = line?.productId;
  const allowedBasePlans = ALLOWED_BASE_PLANS.get(productId);
  if (!line || !allowedBasePlans) return {valid: false};
  const basePlanId = line.offerDetails?.basePlanId || null;
  if (!basePlanId || !allowedBasePlans.has(basePlanId)) return {valid: false};

  const expiresAt = line.expiryTime || null;
  const futureExpiry = expiresAt && new Date(expiresAt).getTime() > Date.now();
  const state = String(data.subscriptionState || '');
  let status = 'expired';
  if (state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') status = 'grace_period';
  else if (state === 'SUBSCRIPTION_STATE_ACTIVE' || (state === 'SUBSCRIPTION_STATE_CANCELED' && futureExpiry)) status = 'active';
  else if (state === 'SUBSCRIPTION_STATE_PAUSED' || state === 'SUBSCRIPTION_STATE_ON_HOLD') status = 'paused';
  else if (state === 'SUBSCRIPTION_STATE_PENDING') status = 'pending';

  const entitled = ['active', 'grace_period'].includes(status) && Boolean(futureExpiry);
  return {
    valid: true,
    entitled,
    purchaseType: 'subscription',
    productId,
    basePlanId,
    status,
    transactionId: data.latestOrderId || `google-subscription-${data.startTime || 'unknown'}`,
    originalTransactionId: data.linkedPurchaseToken || null,
    currentPeriodEndsAt: expiresAt,
    autoRenewing: Boolean(line.autoRenewingPlan?.autoRenewEnabled),
    accountId: data.externalAccountIdentifiers?.obfuscatedExternalAccountId || null,
    acknowledgementPending: data.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
    rawStorePayload: data,
  };
}

function normalizeLifetime(productId, data) {
  if (!data) return {valid: false};
  const purchaseState = Number(data.purchaseState);
  const status = purchaseState === 0 ? 'active' : purchaseState === 2 ? 'pending' : 'revoked';
  return {
    valid: true,
    entitled: status === 'active',
    purchaseType: 'lifetime',
    productId,
    basePlanId: null,
    status,
    transactionId: data.orderId || `google-lifetime-${data.purchaseTimeMillis || 'unknown'}`,
    originalTransactionId: null,
    currentPeriodEndsAt: null,
    autoRenewing: false,
    accountId: data.obfuscatedExternalAccountId || null,
    acknowledgementPending: Number(data.acknowledgementState) === 0,
    rawStorePayload: data,
  };
}

function mockPurchase(productId, purchaseToken, userId) {
  if (productId === INDIVIDUAL_SUBSCRIPTION_PRODUCT_ID && ['test-monthly-token', 'test-yearly-token'].includes(purchaseToken)) {
    const basePlanId = purchaseToken.includes('yearly') ? 'yearly' : 'monthly';
    return {
      valid: true,
      entitled: true,
      purchaseType: 'subscription',
      productId,
      basePlanId,
      status: 'active',
      transactionId: `test-order-${basePlanId}`,
      originalTransactionId: null,
      currentPeriodEndsAt: new Date(Date.now() + 31 * 24 * 60 * 60_000).toISOString(),
      autoRenewing: true,
      accountId: userId,
      acknowledgementPending: true,
      rawStorePayload: {provider: 'test', basePlanId},
    };
  }
  if (productId === FAMILY_SUBSCRIPTION_PRODUCT_ID &&
      /^test-family-(monthly|yearly)-(?:[3-8])-token$/.test(purchaseToken)) {
    const [, period, capacity] = /^test-family-(monthly|yearly)-([3-8])-token$/.exec(purchaseToken);
    const basePlanId = `family-${period}-${capacity}`;
    return {
      valid: true,
      entitled: true,
      purchaseType: 'subscription',
      productId,
      basePlanId,
      status: 'active',
      transactionId: `test-order-${basePlanId}`,
      originalTransactionId: null,
      currentPeriodEndsAt: new Date(Date.now() + 31 * 24 * 60 * 60_000).toISOString(),
      autoRenewing: true,
      accountId: userId,
      acknowledgementPending: true,
      rawStorePayload: {provider: 'test', basePlanId},
    };
  }
  if (productId === INDIVIDUAL_LIFETIME_PRODUCT_ID && purchaseToken === 'test-lifetime-token') {
    return {
      valid: true,
      entitled: true,
      purchaseType: 'lifetime',
      productId,
      basePlanId: null,
      status: 'active',
      transactionId: 'test-order-lifetime',
      originalTransactionId: null,
      currentPeriodEndsAt: null,
      autoRenewing: false,
      accountId: userId,
      acknowledgementPending: true,
      rawStorePayload: {provider: 'test'},
    };
  }
  const familyLifetime = /^dindin_family_lifetime_([3-8])$/.exec(productId);
  if (familyLifetime && purchaseToken === `test-family-lifetime-${familyLifetime[1]}-token`) {
    return {
      valid: true,
      entitled: true,
      purchaseType: 'lifetime',
      productId,
      basePlanId: null,
      status: 'active',
      transactionId: `test-order-family-lifetime-${familyLifetime[1]}`,
      originalTransactionId: null,
      currentPeriodEndsAt: null,
      autoRenewing: false,
      accountId: userId,
      acknowledgementPending: true,
      rawStorePayload: {provider: 'test', capacity: Number(familyLifetime[1])},
    };
  }
  return {valid: false};
}

export async function verifyGooglePlayPurchase({productId, purchaseToken, userId}) {
  if (isTestProvider()) return mockPurchase(productId, purchaseToken, userId);
  if (isSubscriptionProduct(productId)) {
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName())}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const data = await googleRequest({url, method: 'GET'});
    return data ? normalizeSubscription(data) : {valid: false};
  }
  if (productId === INDIVIDUAL_LIFETIME_PRODUCT_ID || FAMILY_LIFETIME_PRODUCT_IDS.includes(productId)) {
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName())}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
    return normalizeLifetime(productId, await googleRequest({url, method: 'GET'}));
  }
  return {valid: false};
}

export async function acknowledgeGooglePlayPurchase({productId, purchaseToken}) {
  if (isTestProvider()) return;
  const encodedPackage = encodeURIComponent(packageName());
  const encodedProduct = encodeURIComponent(productId);
  const encodedToken = encodeURIComponent(purchaseToken);
  const path = isSubscriptionProduct(productId)
    ? `purchases/subscriptions/${encodedProduct}/tokens/${encodedToken}:acknowledge`
    : `purchases/products/${encodedProduct}/tokens/${encodedToken}:acknowledge`;
  await googleRequest({
    url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/${path}`,
    method: 'POST',
    data: {},
  });
}

export const GOOGLE_PLAY_PRODUCTS = {
  subscription: INDIVIDUAL_SUBSCRIPTION_PRODUCT_ID,
  familySubscription: FAMILY_SUBSCRIPTION_PRODUCT_ID,
  lifetime: INDIVIDUAL_LIFETIME_PRODUCT_ID,
  familyLifetime: FAMILY_LIFETIME_PRODUCT_IDS,
};

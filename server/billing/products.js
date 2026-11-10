export const INDIVIDUAL_SUBSCRIPTION_PRODUCT_ID = 'dindin_premium';
export const FAMILY_SUBSCRIPTION_PRODUCT_ID = 'dindin_family';
export const INDIVIDUAL_LIFETIME_PRODUCT_ID = 'dindin_lifetime';

export const FAMILY_MIN_CAPACITY = 3;
export const FAMILY_MAX_CAPACITY = 8;
export const FAMILY_CAPACITIES = Object.freeze(
  Array.from(
    {length: FAMILY_MAX_CAPACITY - FAMILY_MIN_CAPACITY + 1},
    (_, index) => FAMILY_MIN_CAPACITY + index,
  ),
);

export const FAMILY_LIFETIME_PRODUCT_IDS = Object.freeze(
  FAMILY_CAPACITIES.map(capacity => `dindin_family_lifetime_${capacity}`),
);

export const INDIVIDUAL_BASE_PLAN_IDS = Object.freeze(['monthly', 'yearly']);
export const FAMILY_BASE_PLAN_IDS = Object.freeze([
  ...FAMILY_CAPACITIES.flatMap(capacity => [
    `family-monthly-${capacity}`,
    `family-yearly-${capacity}`,
  ]),
  // Preserve already-purchased legacy plans until their entitlement expires.
  'family-monthly',
  'family-yearly',
]);

export function isFamilyProduct(productId) {
  return productId === FAMILY_SUBSCRIPTION_PRODUCT_ID ||
    FAMILY_LIFETIME_PRODUCT_IDS.includes(productId);
}

export function isSubscriptionProduct(productId) {
  return productId === INDIVIDUAL_SUBSCRIPTION_PRODUCT_ID ||
    productId === FAMILY_SUBSCRIPTION_PRODUCT_ID;
}

export function isSupportedGooglePlayProduct(productId) {
  return isSubscriptionProduct(productId) ||
    productId === INDIVIDUAL_LIFETIME_PRODUCT_ID ||
    FAMILY_LIFETIME_PRODUCT_IDS.includes(productId);
}

export function familyCapacityFor(productId, basePlanId = null) {
  if (productId === FAMILY_SUBSCRIPTION_PRODUCT_ID) {
    const match = /^family-(?:monthly|yearly)-(\d+)$/.exec(String(basePlanId || ''));
    if (match) {
      const capacity = Number(match[1]);
      return FAMILY_CAPACITIES.includes(capacity) ? capacity : null;
    }
    // The previous plans covered the purchaser and three added members.
    if (['family-monthly', 'family-yearly'].includes(basePlanId)) return 4;
    return null;
  }
  const lifetimeMatch = /^dindin_family_lifetime_(\d+)$/.exec(String(productId || ''));
  if (!lifetimeMatch) return null;
  const capacity = Number(lifetimeMatch[1]);
  return FAMILY_CAPACITIES.includes(capacity) ? capacity : null;
}

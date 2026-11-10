import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useIAP,
  type Product,
  type ProductSubscription,
  type Purchase,
  type SubscriptionOffer,
} from 'react-native-iap';
import {
  AppShell,
  Brand,
  Field,
  FloatingMascot,
  Icon,
  PrimaryButton,
  ScreenHeader,
} from '../components/ui';
import {DEVELOPMENT_PREVIEW_ENABLED} from '../config';
import {verifyPurchaseOnServer} from '../services/checkIns';
import {readAuthSession} from '../services/storage';
import {colors, radii} from '../theme';

export function WelcomeScreen({onStart}: {onStart: () => void}) {
  return (
    <AppShell contentStyle={styles.welcome}>
      <View style={styles.brandTop}>
        <Brand />
        <Text style={styles.brandTagline}>A gentle ping. Complete peace of mind.</Text>
      </View>
      <FloatingMascot size={215} />
      <View style={styles.welcomeCopy}>
        <Text style={styles.hero}>Check in.{`\n`}Reassure them.</Text>
        <Text style={styles.heroSub}>
          Set reminders for yourself. If you miss both, Din Din alerts your
          selected primary contacts on WhatsApp.
        </Text>
      </View>
      <View style={styles.actions}>
        <PrimaryButton label="Get started" onPress={onStart} testID="get-started" />
        <View style={styles.trustRow}>
          <Icon name="shield" size={17} color={colors.teal} />
          <Text style={styles.trustText}>Private by design</Text>
        </View>
      </View>
    </AppShell>
  );
}

export function RegisterScreen({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: (phone: string, name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const cleanPhone = phone.replace(/\D/g, '').slice(0, 10);
  const valid = name.trim().length >= 2 && cleanPhone.length === 10;
  return (
    <AppShell keyboard>
      <ScreenHeader title="Create your account" subtitle="It only takes a minute" onBack={onBack} />
      <View style={styles.miniMascotRow}>
        <FloatingMascot size={112} />
        <View style={styles.speechCard}>
          <Text style={styles.speechTitle}>Namaste!</Text>
          <Text style={styles.speechText}>Let’s set up your personal check-in.</Text>
        </View>
      </View>
      <View style={styles.form}>
        <Field
          label="Your name"
          placeholder="Enter your full name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          error={attempted && name.trim().length < 2 ? 'Please enter your name' : undefined}
        />
        <Field
          label="Mobile number"
          prefix="+91"
          placeholder="10-digit mobile number"
          keyboardType="phone-pad"
          value={cleanPhone}
          onChangeText={setPhone}
          maxLength={10}
          error={attempted && cleanPhone.length !== 10 ? 'Enter a valid 10-digit number' : undefined}
          hint="We’ll send a verification code to this number."
        />
      </View>
      <View style={styles.noticeCard}>
        <Icon name="shield" size={20} color={colors.teal} />
        <Text style={styles.noticeText}>
          By continuing, you agree to Din Din’s Terms and Privacy Policy.
        </Text>
      </View>
      {message ? <Text style={styles.formMessage}>{message}</Text> : null}
      <View style={styles.bottomActions}>
        <PrimaryButton
          label={submitting ? 'Sending code…' : 'Continue'}
          disabled={submitting}
          onPress={async () => {
            setAttempted(true);
            if (valid) {
              setSubmitting(true);
              setMessage('');
              try {
                await onContinue(cleanPhone, name.trim());
              } catch (sendError) {
                setMessage(
                  sendError instanceof Error
                    ? sendError.message
                    : 'Could not send the verification code. Please try again.',
                );
              } finally {
                setSubmitting(false);
              }
            }
          }}
        />
      </View>
    </AppShell>
  );
}

export function OtpScreen({
  phone,
  onBack,
  onResend,
  onVerified,
}: {
  phone: string;
  onBack: () => void;
  onResend: () => Promise<void>;
  onVerified: (otp: string) => Promise<void>;
}) {
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(60);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (seconds <= 0) {
      return;
    }
    const timer = setInterval(() => setSeconds(value => value - 1), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  const verify = async () => {
    setVerifying(true);
    setError('');
    try {
      await onVerified(otp);
    } catch (verificationError) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : 'That code is not correct. Please try again.',
      );
      Animated.sequence([
        Animated.timing(shake, {toValue: -8, duration: 55, useNativeDriver: true}),
        Animated.timing(shake, {toValue: 8, duration: 55, useNativeDriver: true}),
        Animated.timing(shake, {toValue: -5, duration: 55, useNativeDriver: true}),
        Animated.timing(shake, {toValue: 0, duration: 55, useNativeDriver: true}),
      ]).start();
    } finally {
      setVerifying(false);
    }
  };

  return (
    <AppShell keyboard>
      <ScreenHeader title="Verify your number" subtitle="One quick security check" onBack={onBack} />
      <View style={styles.otpArt}>
        <View style={styles.phoneBubble}>
          <Icon name="message" size={32} color={colors.tealDark} />
          <View style={styles.messageDots}>
            <View style={styles.messageDot} />
            <View style={styles.messageDot} />
            <View style={styles.messageDot} />
          </View>
        </View>
      </View>
      <Text style={styles.sectionTitle}>Enter verification code</Text>
      <Text style={styles.centerCopy}>
        We sent a 6-digit code to +91 {phone.slice(0, 2)}••• ••{phone.slice(-3)}
      </Text>
      <Animated.View style={[styles.otpWrap, {transform: [{translateX: shake}]}]}>
        <Field
          label="Verification code"
          placeholder="••••••"
          value={otp}
          onChangeText={value => setOtp(value.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          secureTextEntry
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          error={error || undefined}
          style={styles.otpInput}
        />
      </Animated.View>
      <Pressable
        disabled={seconds > 0 || resending}
        onPress={async () => {
          setResending(true);
          setError('');
          try {
            await onResend();
            setSeconds(60);
          } catch (sendError) {
            setError(
              sendError instanceof Error
                ? sendError.message
                : 'Could not resend the code. Please try again.',
            );
          } finally {
            setResending(false);
          }
        }}
        style={styles.resendButton}>
        <Text style={[styles.resendText, seconds > 0 && styles.resendDisabled]}>
          {resending
            ? 'Sending…'
            : seconds > 0
              ? `Resend code in 00:${String(seconds).padStart(2, '0')}`
              : 'Resend code'}
        </Text>
      </Pressable>
      <View style={styles.bottomActions}>
        <PrimaryButton
          label={verifying ? 'Verifying…' : 'Verify & continue'}
          onPress={verify}
          disabled={otp.length !== 6 || verifying}
        />
      </View>
    </AppShell>
  );
}

const PREMIUM_PRODUCT_ID = 'dindin_premium';
const FAMILY_PRODUCT_ID = 'dindin_family';
const LIFETIME_PRODUCT_ID = 'dindin_lifetime';
const FAMILY_CAPACITIES = [3, 4, 5, 6, 7, 8] as const;
const FAMILY_LIFETIME_PRODUCT_IDS = FAMILY_CAPACITIES.map(
  capacity => `dindin_family_lifetime_${capacity}`,
);

type PlanKey =
  | 'monthly'
  | 'yearly'
  | 'lifetime'
  | 'family-monthly'
  | 'family-yearly'
  | 'family-lifetime';

type Plan = {
  key: PlanKey;
  group: 'individual' | 'family';
  type: 'subs' | 'in-app';
  productId: string;
  basePlanId: string | null;
  name: string;
  fallback: string;
  note: string;
  badge?: string;
  capacity?: number;
};

const INDIVIDUAL_PLANS: Plan[] = [
  {
    key: 'monthly',
    group: 'individual',
    type: 'subs',
    productId: PREMIUM_PRODUCT_ID,
    basePlanId: 'monthly',
    name: 'Monthly',
    fallback: '₹350 / month',
    note: 'Flexible month to month',
  },
  {
    key: 'yearly',
    group: 'individual',
    type: 'subs',
    productId: PREMIUM_PRODUCT_ID,
    basePlanId: 'yearly',
    name: 'Yearly',
    fallback: '₹3,200 / year',
    note: 'Save ₹1,000 compared with monthly',
    badge: 'BEST VALUE',
  },
  {
    key: 'lifetime',
    group: 'individual',
    type: 'in-app',
    productId: LIFETIME_PRODUCT_ID,
    basePlanId: null,
    name: 'Lifetime',
    fallback: '₹6,000 once',
    note: 'One payment, permanent access',
    badge: 'ONE TIME',
  },
];

function familyPlan(key: Extract<PlanKey, `family-${string}`>, capacity: number): Plan {
  if (key === 'family-lifetime') {
    return {
      key,
      group: 'family',
      type: 'in-app',
      productId: `dindin_family_lifetime_${capacity}`,
      basePlanId: null,
      name: 'Family lifetime',
      fallback: `₹${(capacity * 6500).toLocaleString('en-IN')} once`,
      note: `Permanent access for ${capacity} accounts`,
      badge: 'ONE TIME',
      capacity,
    };
  }
  const yearly = key === 'family-yearly';
  return {
    key,
    group: 'family',
    type: 'subs',
    productId: FAMILY_PRODUCT_ID,
    basePlanId: `family-${yearly ? 'yearly' : 'monthly'}-${capacity}`,
    name: yearly ? 'Family yearly' : 'Family monthly',
    fallback: yearly
      ? `₹${(capacity * 3000).toLocaleString('en-IN')} / year`
      : `₹${(capacity * 250).toLocaleString('en-IN')} / month`,
    note: `${capacity} covered accounts including you`,
    badge: yearly ? 'FAMILY VALUE' : undefined,
    capacity,
  };
}

function capacityFromBasePlan(basePlanId?: string | null) {
  const match = /^family-(?:monthly|yearly)-(\d+)$/.exec(basePlanId || '');
  return match ? Number(match[1]) : null;
}

export function SubscriptionScreen({
  onActivated,
  onDevelopmentPreview,
  onClose,
  minimumFamilyCapacity = 3,
  initialPlanGroup = 'individual',
}: {
  onActivated: () => void;
  onDevelopmentPreview: () => void;
  onClose?: () => void;
  minimumFamilyCapacity?: number;
  initialPlanGroup?: 'individual' | 'family';
}) {
  const normalizedMinimumFamilyCapacity = Math.max(3, Math.min(8, minimumFamilyCapacity));
  const [selected, setSelected] = useState<PlanKey>(
    initialPlanGroup === 'family' ? 'family-yearly' : 'yearly',
  );
  const [planGroup, setPlanGroup] = useState<'individual' | 'family'>(initialPlanGroup);
  const [familyCapacity, setFamilyCapacity] = useState(normalizedMinimumFamilyCapacity);
  const [message, setMessage] = useState('');
  const [processing, setProcessing] = useState(false);
  const purchaseHandler = useRef<(purchase: Purchase) => Promise<boolean>>(async () => false);
  const processingTokens = useRef(new Set<string>());
  const restoreRequested = useRef(false);

  const {
    connected,
    products,
    subscriptions,
    availablePurchases,
    fetchProducts,
    getActiveSubscriptions,
    requestPurchase,
    finishTransaction,
    restorePurchases,
  } = useIAP({
    onPurchaseSuccess: purchase => {
      purchaseHandler.current(purchase);
    },
    onPurchaseError: error => {
      setProcessing(false);
      setMessage(error.message || 'The purchase could not be completed.');
    },
    onError: error => setMessage(error.message),
  });

  const processPurchase = useCallback(async (purchase: Purchase, activateOnSuccess = true) => {
    if (![
      PREMIUM_PRODUCT_ID,
      FAMILY_PRODUCT_ID,
      LIFETIME_PRODUCT_ID,
      ...FAMILY_LIFETIME_PRODUCT_IDS,
    ].includes(purchase.productId)) return false;
    const tokenKey = purchase.purchaseToken || purchase.transactionId || purchase.id;
    if (processingTokens.current.has(tokenKey)) return false;
    processingTokens.current.add(tokenKey);
    setProcessing(true);
    try {
      const result = await verifyPurchaseOnServer({
        platform: Platform.OS,
        purchase: {
          productId: purchase.productId,
          purchaseToken: purchase.purchaseToken,
          transactionId: purchase.transactionId,
          purchaseState: purchase.purchaseState,
        },
      });
      if (!result.valid || !result.entitlement.active) {
        setMessage('Google Play has not completed this purchase yet. Please try Restore purchase shortly.');
        return false;
      }
      // Google purchases are acknowledged by the verified backend. StoreKit
      // transactions still need to be finalized on-device when iOS is enabled.
      if (Platform.OS !== 'android') {
        await finishTransaction({purchase, isConsumable: false});
      }
      setMessage('Purchase verified successfully.');
      if (activateOnSuccess) onActivated();
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'We could not verify this purchase yet. Please use Restore purchase.',
      );
      return false;
    } finally {
      processingTokens.current.delete(tokenKey);
      setProcessing(false);
    }
  }, [finishTransaction, onActivated]);
  purchaseHandler.current = processPurchase;

  useEffect(() => {
    if (connected) {
      Promise.all([
        fetchProducts({skus: [PREMIUM_PRODUCT_ID, FAMILY_PRODUCT_ID], type: 'subs'}),
        fetchProducts({skus: [LIFETIME_PRODUCT_ID, ...FAMILY_LIFETIME_PRODUCT_IDS], type: 'in-app'}),
      ]).catch(error => setMessage(
        error instanceof Error ? error.message : 'Unable to load Google Play plans.',
      ));
    }
  }, [connected, fetchProducts]);

  const subscriptionProducts = useMemo(() => new Map(
    subscriptions.map(product => [product.id, product]),
  ), [subscriptions]);

  const offers = useMemo(() => {
    const map = new Map<string, SubscriptionOffer>();
    subscriptionProducts.forEach(product => {
      if (product.platform === 'android') {
        product.subscriptionOffers.forEach(offer => {
          if (offer.basePlanIdAndroid) map.set(`${product.id}:${offer.basePlanIdAndroid}`, offer);
        });
      }
    });
    return map;
  }, [subscriptionProducts]);

  const lifetimeProducts = useMemo(() => new Map<string, Product>(
    products.map(product => [product.id, product]),
  ), [products]);

  useEffect(() => {
    setFamilyCapacity(previous => Math.max(
      previous,
      normalizedMinimumFamilyCapacity,
    ));
  }, [normalizedMinimumFamilyCapacity]);

  useEffect(() => {
    setPlanGroup(initialPlanGroup);
    setSelected(initialPlanGroup === 'family' ? 'family-yearly' : 'yearly');
  }, [initialPlanGroup]);

  const displayedPlans = useMemo<Plan[]>(() => (
    planGroup === 'individual'
      ? INDIVIDUAL_PLANS
      : [
          familyPlan('family-monthly', familyCapacity),
          familyPlan('family-yearly', familyCapacity),
          familyPlan('family-lifetime', familyCapacity),
        ]
  ), [familyCapacity, planGroup]);

  useEffect(() => {
    if (!restoreRequested.current || !availablePurchases.length) return;
    restoreRequested.current = false;
    const processAvailablePurchases = async () => {
      let restored = false;
      for (const purchase of availablePurchases) {
        restored = await processPurchase(purchase, false) || restored;
      }
      if (restored) {
        setMessage('Purchases restored successfully.');
        onActivated();
        return;
      }
      setProcessing(false);
      setMessage('No active Din Din purchase was found for this Google Play account.');
    };
    processAvailablePurchases();
  }, [availablePurchases, onActivated, processPurchase]);

  const planPrice = (plan: Plan) => {
    if (plan.type === 'in-app') return lifetimeProducts.get(plan.productId)?.displayPrice || plan.fallback;
    return offers.get(`${plan.productId}:${plan.basePlanId}`)?.displayPrice || plan.fallback;
  };

  const restore = async () => {
    setMessage('Checking purchases on Google Play…');
    setProcessing(true);
    restoreRequested.current = true;
    try {
      await restorePurchases({includeSuspendedAndroid: true});
      if (!availablePurchases.length) {
        setProcessing(false);
        setMessage('Google Play is checking this account. Restored purchases will appear automatically.');
      }
    } catch (error) {
      restoreRequested.current = false;
      setProcessing(false);
      setMessage(error instanceof Error ? error.message : 'Restore failed.');
    }
  };

  const buy = async () => {
    const plan = displayedPlans.find(item => item.key === selected);
    if (!plan) {
      setMessage('Choose a Din Din plan to continue.');
      return;
    }
    setMessage('');
    if (Platform.OS !== 'android') {
      setMessage('App Store purchases will be available after the iOS products are configured.');
      return;
    }
    const session = await readAuthSession();
    if (!session) {
      setMessage('Your Din Din session has expired. Please register again.');
      return;
    }
    if (!connected) {
      setMessage('Google Play is not connected. Please check the Play Store and try again.');
      return;
    }
    setProcessing(true);
    try {
      if (plan.type === 'in-app') {
        const lifetimeProduct = lifetimeProducts.get(plan.productId);
        if (!lifetimeProduct) throw new Error(`${plan.name} is not available from Google Play yet.`);
        if (plan.group === 'family') {
          const activeFamily = (await getActiveSubscriptions([FAMILY_PRODUCT_ID]))
            .find(subscription => subscription.productId === FAMILY_PRODUCT_ID && subscription.isActive);
          if (activeFamily) {
            const confirmed = await new Promise<boolean>(resolve => {
              Alert.alert(
                'Recurring family plan remains active',
                'Google Play does not automatically cancel a monthly or yearly plan when you buy lifetime access. Continue only if you will cancel the recurring plan separately.',
                [
                  {text: 'Cancel', style: 'cancel', onPress: () => resolve(false)},
                  {text: 'Continue', onPress: () => resolve(true)},
                ],
                {cancelable: true, onDismiss: () => resolve(false)},
              );
            });
            if (!confirmed) {
              setProcessing(false);
              return;
            }
          }
        }
        await requestPurchase({
          type: 'in-app',
          request: {
            apple: {sku: plan.productId},
            google: {skus: [plan.productId], obfuscatedAccountId: session.userId},
          },
        });
      } else {
        const subscriptionProduct = subscriptionProducts.get(plan.productId) as ProductSubscription | undefined;
        const offer = offers.get(`${plan.productId}:${plan.basePlanId}`);
        if (!subscriptionProduct || !offer?.offerTokenAndroid) {
          throw new Error(`${plan.name} is not available from Google Play yet.`);
        }
        const activeFamily = plan.group === 'family'
          ? (await getActiveSubscriptions([FAMILY_PRODUCT_ID]))
              .find(subscription => subscription.productId === FAMILY_PRODUCT_ID && subscription.isActive)
          : undefined;
        const oldPlanId = activeFamily?.basePlanIdAndroid || activeFamily?.currentPlanId;
        if (activeFamily && oldPlanId === plan.basePlanId) {
          throw new Error('This family plan is already active.');
        }
        const oldCapacity = capacityFromBasePlan(oldPlanId);
        if (oldCapacity && plan.capacity && plan.capacity < oldCapacity) {
          throw new Error('Assigned family accounts cannot be moved to a smaller plan.');
        }
        const purchaseToken = activeFamily?.purchaseTokenAndroid || activeFamily?.purchaseToken;
        await requestPurchase({
          type: 'subs',
          request: {
            apple: {sku: plan.productId},
            google: {
              skus: [plan.productId],
              obfuscatedAccountId: session.userId,
              subscriptionOffers: [{
                sku: plan.productId,
                offerToken: offer.offerTokenAndroid,
              }],
              ...(purchaseToken ? {
                purchaseToken,
                subscriptionProductReplacementParams: {
                  oldProductId: FAMILY_PRODUCT_ID,
                  replacementMode: (plan.capacity || 0) > (oldCapacity || 0)
                    ? 'charge-prorated-price' as const
                    : 'with-time-proration' as const,
                },
              } : {}),
            },
          },
        });
      }
    } catch (error) {
      setProcessing(false);
      setMessage(error instanceof Error ? error.message : 'Unable to start purchase.');
    }
  };

  return (
    <AppShell>
      {onClose ? <ScreenHeader title="Din Din Premium" subtitle="Unlock safety reminders" onBack={onClose} /> : null}
      <View style={styles.subscriptionBrand}>
        <Brand compact />
      </View>
      <View style={styles.subscriptionHero}>
        <FloatingMascot size={105} />
        <View style={styles.subscriptionCopy}>
          <Text style={styles.sectionTitleLeft}>Peace of mind,{`\n`}every day.</Text>
          <Text style={styles.bodyCopy}>Choose a plan for self reminders and missed check-in alerts.</Text>
        </View>
      </View>
      <View style={styles.featureStrip}>
        <Feature icon="bell" text="Self reminders" />
        <Feature icon="whatsapp" text="Circle alerts" />
        <Feature icon="shield" text="Private & secure" />
      </View>
      <View style={styles.planGroupTabs}>
        <Pressable
          onPress={() => { setPlanGroup('individual'); setSelected('yearly'); }}
          style={[styles.planGroupTab, planGroup === 'individual' && styles.planGroupTabSelected]}>
          <Text style={[styles.planGroupText, planGroup === 'individual' && styles.planGroupTextSelected]}>Individual</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setPlanGroup('family');
            setSelected('family-yearly');
            setFamilyCapacity(normalizedMinimumFamilyCapacity);
          }}
          style={[styles.planGroupTab, planGroup === 'family' && styles.planGroupTabSelected]}>
          <Text style={[styles.planGroupText, planGroup === 'family' && styles.planGroupTextSelected]}>Family</Text>
        </Pressable>
      </View>
      {planGroup === 'family' ? (
        <View style={styles.familyCapacityCard}>
          <View style={styles.familyCapacityHeading}>
            <View>
              <Text style={styles.familyCapacityTitle}>Covered accounts</Text>
              <Text style={styles.familyCapacitySubtitle}>Includes your own Din Din account</Text>
            </View>
            <Text style={styles.familyCapacityValue}>{familyCapacity}</Text>
          </View>
          <View style={styles.familyCapacityOptions}>
            {FAMILY_CAPACITIES.filter(capacity => capacity >= normalizedMinimumFamilyCapacity).map(capacity => (
              <Pressable
                key={capacity}
                accessibilityRole="radio"
                accessibilityLabel={`${capacity} covered accounts`}
                accessibilityState={{selected: familyCapacity === capacity}}
                onPress={() => setFamilyCapacity(capacity)}
                style={[
                  styles.familyCapacityOption,
                  familyCapacity === capacity && styles.familyCapacityOptionSelected,
                ]}>
                <Text style={[
                  styles.familyCapacityOptionText,
                  familyCapacity === capacity && styles.familyCapacityOptionTextSelected,
                ]}>{capacity}</Text>
              </Pressable>
            ))}
          </View>
          {normalizedMinimumFamilyCapacity > 3 ? (
            <Text style={styles.familyCapacityUpgradeNote}>
              Smaller plans are unavailable because assigned numbers are permanent.
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.planList}>
        {displayedPlans.map(plan => {
          const isSelected = selected === plan.key;
          return (
            <Pressable
              key={plan.key}
              accessibilityRole="radio"
              accessibilityState={{selected: isSelected}}
              onPress={() => setSelected(plan.key)}
              style={[styles.planCard, isSelected && styles.planCardSelected]}>
              <View style={[styles.radio, isSelected && styles.radioSelected]}>
                {isSelected && <View style={styles.radioInner} />}
              </View>
              <View style={styles.planText}>
                <View style={styles.planNameRow}>
                  <Text style={styles.planName}>{plan.name}</Text>
                  {'badge' in plan && plan.badge && <Text style={styles.planBadge}>{plan.badge}</Text>}
                </View>
                <Text style={styles.planNote}>{plan.note}</Text>
              </View>
              <Text style={styles.planPrice}>{planPrice(plan)}</Text>
            </Pressable>
          );
        })}
      </View>
      {message ? <Text style={styles.billingMessage}>{message}</Text> : null}
      <View style={styles.subscriptionActions}>
        <PrimaryButton
          label={processing ? 'Please wait…' : selected.includes('lifetime') ? 'Get lifetime access' : 'Start subscription'}
          onPress={buy}
          disabled={processing}
        />
        <PrimaryButton
          label="Restore purchase"
          variant="ghost"
          onPress={restore}
          disabled={processing}
        />
        {DEVELOPMENT_PREVIEW_ENABLED ? (
          <PrimaryButton
            label="Continue in development preview"
            variant="ghost"
            onPress={onDevelopmentPreview}
            disabled={processing}
          />
        ) : null}
      </View>
      <Text style={styles.legal}>
        Monthly and yearly plans renew until cancelled in Google Play. Family capacity includes the purchaser, and assigned member numbers cannot be replaced. Lifetime purchases are one-time and are not prorated against previous purchases.
      </Text>
    </AppShell>
  );
}

export function SafetySetupScreen({
  enabling,
  onEnable,
  onSkip,
}: {
  enabling: boolean;
  onEnable: () => void;
  onSkip: () => void;
}) {
  return (
    <AppShell>
      <View style={styles.safetySetupIcon}>
        <Icon name="shield" size={35} color={colors.tealDark} />
      </View>
      <Text style={styles.sectionTitle}>Enable safety location</Text>
      <Text style={styles.centerCopy}>
        Din Din needs “Always” location access so it can share one fresh or last-known location if you miss both reminders or tap No.
      </Text>
      <View style={styles.safetyPoints}>
        <SafetyPoint text="Captured now, then refreshed only when a safety alert may be needed" />
        <SafetyPoint text="Missed alerts go to primary contacts; No alerts your full circle" />
        <SafetyPoint text="Stored while your account is active; never used for ads or continuous tracking" />
      </View>
      <View style={styles.bottomActions}>
        <PrimaryButton
          label={enabling ? 'Enabling location…' : 'Enable safety location'}
          disabled={enabling}
          onPress={onEnable}
          icon="shield"
        />
        <PrimaryButton label="Not now" variant="ghost" onPress={onSkip} disabled={enabling} />
      </View>
    </AppShell>
  );
}

function SafetyPoint({text}: {text: string}) {
  return (
    <View style={styles.safetyPoint}>
      <View style={styles.safetyCheck}><Icon name="check" size={15} color={colors.tealDark} /></View>
      <Text style={styles.safetyPointText}>{text}</Text>
    </View>
  );
}

function Feature({icon, text}: {icon: 'whatsapp' | 'bell' | 'shield'; text: string}) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}><Icon name={icon} size={19} color={colors.tealDark} /></View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  welcome: {justifyContent: 'space-between', paddingTop: 16},
  brandTop: {alignItems: 'center', gap: 5},
  brandTagline: {color: colors.muted, fontSize: 13, fontWeight: '600'},
  welcomeCopy: {gap: 12, marginTop: -10},
  hero: {fontSize: 38, lineHeight: 43, color: colors.ink, fontWeight: '900', letterSpacing: -1.25},
  heroSub: {fontSize: 16, lineHeight: 24, color: colors.inkSoft, fontWeight: '500'},
  actions: {gap: 15, marginTop: 22},
  trustRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7},
  trustText: {fontSize: 12, fontWeight: '700', color: colors.muted},
  miniMascotRow: {flexDirection: 'row', alignItems: 'center', marginVertical: 5},
  speechCard: {flex: 1, padding: 16, borderRadius: radii.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, marginLeft: -10},
  speechTitle: {fontSize: 18, fontWeight: '900', color: colors.ink},
  speechText: {fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 4},
  form: {gap: 18, marginTop: 4},
  noticeCard: {flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, backgroundColor: colors.mintSoft, borderRadius: radii.md, marginTop: 20},
  noticeText: {flex: 1, fontSize: 12, lineHeight: 18, color: colors.inkSoft},
  formMessage: {fontSize: 12, lineHeight: 17, color: '#9A5415', backgroundColor: colors.amberSoft, borderRadius: 12, padding: 10, marginTop: 10},
  bottomActions: {marginTop: 'auto', paddingTop: 28},
  otpArt: {alignItems: 'center', marginVertical: 24},
  phoneBubble: {width: 105, height: 105, borderRadius: 34, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', transform: [{rotate: '-3deg'}]},
  messageDots: {flexDirection: 'row', gap: 4, marginTop: 9},
  messageDot: {width: 5, height: 5, borderRadius: 3, backgroundColor: colors.teal},
  sectionTitle: {fontSize: 26, lineHeight: 32, color: colors.ink, fontWeight: '900', textAlign: 'center', letterSpacing: -0.6},
  sectionTitleLeft: {fontSize: 27, lineHeight: 32, color: colors.ink, fontWeight: '900', letterSpacing: -0.7},
  centerCopy: {fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: 'center', marginTop: 8, marginHorizontal: 26},
  otpWrap: {marginTop: 27},
  otpInput: {fontSize: 27, fontWeight: '900', letterSpacing: 14, textAlign: 'center'},
  resendButton: {alignSelf: 'center', padding: 14, marginTop: 8},
  resendText: {fontSize: 14, fontWeight: '800', color: colors.teal},
  resendDisabled: {color: colors.muted},
  subscriptionBrand: {alignItems: 'center', paddingTop: 5},
  subscriptionHero: {flexDirection: 'row', alignItems: 'center', marginTop: 10},
  subscriptionCopy: {flex: 1, marginLeft: -7, gap: 8},
  bodyCopy: {fontSize: 13, lineHeight: 19, color: colors.muted},
  featureStrip: {flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderRadius: radii.lg, backgroundColor: 'rgba(255,255,255,0.74)', borderWidth: 1, borderColor: colors.line, marginVertical: 16},
  feature: {flex: 1, alignItems: 'center', gap: 6},
  featureIcon: {width: 35, height: 35, borderRadius: 13, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center'},
  featureText: {fontSize: 10, lineHeight: 13, color: colors.inkSoft, fontWeight: '700', textAlign: 'center'},
  planGroupTabs: {flexDirection: 'row', backgroundColor: '#E4ECEB', borderRadius: 15, padding: 4, marginBottom: 12},
  planGroupTab: {flex: 1, minHeight: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center'},
  planGroupTabSelected: {backgroundColor: colors.white, elevation: 2, shadowColor: colors.shadow, shadowOpacity: 0.1, shadowRadius: 5},
  planGroupText: {fontSize: 12, fontWeight: '800', color: colors.muted},
  planGroupTextSelected: {color: colors.tealDark},
  familyCapacityCard: {borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, padding: 13, marginBottom: 12},
  familyCapacityHeading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  familyCapacityTitle: {fontSize: 14, fontWeight: '900', color: colors.ink},
  familyCapacitySubtitle: {fontSize: 10, color: colors.muted, marginTop: 2},
  familyCapacityValue: {fontSize: 22, fontWeight: '900', color: colors.tealDark},
  familyCapacityOptions: {flexDirection: 'row', gap: 7, marginTop: 12},
  familyCapacityOption: {flex: 1, minHeight: 38, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft},
  familyCapacityOptionSelected: {borderColor: colors.teal, backgroundColor: colors.teal},
  familyCapacityOptionText: {fontSize: 13, fontWeight: '900', color: colors.tealDark},
  familyCapacityOptionTextSelected: {color: colors.white},
  familyCapacityUpgradeNote: {fontSize: 10, lineHeight: 14, color: '#9A5415', marginTop: 9},
  planList: {gap: 11},
  planCard: {minHeight: 76, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.line, backgroundColor: 'rgba(255,255,255,0.9)'},
  planCardSelected: {borderColor: colors.teal, backgroundColor: colors.mintSoft, transform: [{scale: 1.01}]},
  radio: {width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#ABC1C4', alignItems: 'center', justifyContent: 'center'},
  radioSelected: {borderColor: colors.teal},
  radioInner: {width: 11, height: 11, borderRadius: 6, backgroundColor: colors.teal},
  planText: {flex: 1},
  planNameRow: {flexDirection: 'row', alignItems: 'center', gap: 7},
  planName: {fontSize: 16, fontWeight: '900', color: colors.ink},
  planBadge: {fontSize: 8, fontWeight: '900', color: colors.white, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, backgroundColor: colors.coral, overflow: 'hidden'},
  planNote: {fontSize: 11, marginTop: 3, color: colors.muted, fontWeight: '600'},
  planPrice: {maxWidth: 92, fontSize: 12, lineHeight: 16, color: colors.tealDark, fontWeight: '800', textAlign: 'right'},
  billingMessage: {fontSize: 12, lineHeight: 17, color: '#9A5415', backgroundColor: colors.amberSoft, borderRadius: 12, padding: 10, marginTop: 10},
  subscriptionActions: {marginTop: 18, gap: 2},
  legal: {fontSize: 10, lineHeight: 14, color: colors.muted, textAlign: 'center', marginHorizontal: 20, marginTop: 6},
  safetySetupIcon: {width: 76, height: 76, borderRadius: 26, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mint, marginTop: 44, marginBottom: 24},
  safetyPoints: {gap: 12, marginTop: 32},
  safetyPoint: {flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: radii.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line},
  safetyCheck: {width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mintSoft},
  safetyPointText: {flex: 1, color: colors.inkSoft, fontSize: 13, lineHeight: 19, fontWeight: '600'},
});

